import { DELETION_GRACE_DAYS } from '@vionx/domain';
import type { ExportJob, HouseholdResponse } from '@vionx/contracts/client';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { parentApi } from '../../src/api.ts';
import { t, type MessageKey } from '../../src/i18n/index.ts';
import { AppError, describeError, unwrap } from '../../src/lib/api-error.ts';
import {
  canChildSignIn,
  formatDay,
  formatDayTime,
  pendingDeletions,
  type PendingDeletionItem,
} from '../../src/lib/consent.ts';
import { signOutGoogle } from '../../src/state/google.ts';
import { signOutParent } from '../../src/state/supabase.ts';
import { useTheme } from '../../src/theme.ts';
import { AVATAR_GLYPHS } from '../../src/ui/avatars.ts';
import { Button } from '../../src/ui/Button.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { StateView } from '../../src/ui/StateView.tsx';
import { useLoad } from '../../src/ui/useLoad.ts';

const POLL_MS = 3000;

/**
 * Privacy Center (Master Spec §34.4): pending deletions with "Hủy yêu cầu xóa" during the 14-day
 * grace period (DELETION_GRACE_DAYS), consents per child, accepted policy versions, data export, account deletion.
 * Child deletion lives on each child's consent screen. While the account deletion is pending the
 * household is hidden (403 ACCOUNT_DISABLED / 404) and only the pending section is shown.
 */
export default function PrivacyCenter() {
  const theme = useTheme();
  const c = theme.colors;
  const { state, reload } = useLoad(async () => {
    const [household, overview] = await Promise.all([
      unwrap(parentApi.GET('/api/v1/household')).catch((e: unknown): HouseholdResponse | null => {
        if (e instanceof AppError && (e.status === 403 || e.status === 404)) return null;
        throw e;
      }),
      unwrap(parentApi.GET('/api/v1/privacy/overview')),
    ]);
    return { household, overview };
  });
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) reload();
      focused.current = true;
    }, [reload]),
  );

  const [job, setJob] = useState<ExportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);

  // Latest export from the overview; its link is fetched on demand.
  const latest = state.kind === 'ready' ? (state.data.overview.exports[0] ?? null) : null;
  const shown = job ?? latest;

  const refreshJob = useCallback(async (id: string) => {
    const res = await unwrap(
      parentApi.GET('/api/v1/privacy/export/{jobId}', { params: { path: { jobId: id } } }),
    );
    setJob(res.job);
    return res.job;
  }, []);

  // Poll while the worker prepares the file.
  useEffect(() => {
    if (!shown || (shown.status !== 'QUEUED' && shown.status !== 'RUNNING')) return;
    const timer = setTimeout(() => void refreshJob(shown.id).catch(() => {}), POLL_MS);
    return () => clearTimeout(timer);
  }, [shown, refreshJob]);

  const startExport = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await unwrap(parentApi.POST('/api/v1/privacy/export'));
      setJob(res.job);
    } catch (e) {
      setMessage({ text: describeError(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const download = async (current: ExportJob) => {
    setMessage(null);
    try {
      const fresh = current.downloadUrl ? current : await refreshJob(current.id);
      if (fresh.downloadUrl) await Linking.openURL(fresh.downloadUrl);
      else setMessage({ text: t('privacy.exportExpired'), tone: 'error' });
    } catch (e) {
      setMessage({ text: describeError(e), tone: 'error' });
    }
  };

  const deleteAccount = () =>
    Alert.alert(
      t('privacy.deleteAccount'),
      t('privacy.deleteAccountConfirm', { days: DELETION_GRACE_DAYS }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('privacy.deleteAccount'),
          style: 'destructive',
          onPress: () =>
            void (async () => {
              setBusy(true);
              try {
                const res = await unwrap(
                  parentApi.POST('/api/v1/account/delete-request', {
                    body: { confirm: true, source: 'app' },
                  }),
                );
                Alert.alert(
                  t('privacy.deleteAccount'),
                  t('privacy.deleteAccountDone', { date: formatDay(res.deletion.purgeAfter) }),
                );
                await signOutGoogle();
                await signOutParent();
                router.replace('/welcome');
              } catch (e) {
                setMessage({ text: describeError(e), tone: 'error' });
              } finally {
                setBusy(false);
              }
            })(),
        },
      ],
    );

  const cancelDeletion = (item: PendingDeletionItem) =>
    Alert.alert(t('privacy.cancelDeletion'), t('privacy.cancelDeletionConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('privacy.cancelDeletion'),
        onPress: () =>
          void (async () => {
            setBusy(true);
            setMessage(null);
            try {
              if (item.scope === 'ACCOUNT') {
                await unwrap(parentApi.POST('/api/v1/account/delete-request/cancel'));
              } else {
                await unwrap(
                  parentApi.POST('/api/v1/students/{id}/delete-request/cancel', {
                    params: { path: { id: item.studentId! } },
                  }),
                );
              }
              setMessage({ text: t('privacy.cancelDeletionDone'), tone: 'info' });
              if (item.scope === 'ACCOUNT') router.replace('/parent');
              else reload();
            } catch (e) {
              setMessage({ text: describeError(e), tone: 'error' });
            } finally {
              setBusy(false);
            }
          })(),
      },
    ]);

  const signOut = async () => {
    await signOutGoogle();
    await signOutParent();
    router.replace('/welcome');
  };

  const section = (title: string) => (
    <Text style={[theme.typography.heading, { color: c.text }]}>{title}</Text>
  );

  return (
    <Screen title={t('privacy.title')} testID="screen-privacy">
      <StateView state={state} reload={reload}>
        {({ household, overview }) => {
          const pending = pendingDeletions(overview.deletions, household?.students ?? []);
          const accountPending = pending.some((p) => p.scope === 'ACCOUNT');
          const pendingSection = pending.length > 0 && (
            <>
              {section(t('privacy.pending'))}
              {accountPending && (
                <Notice
                  testID="account-pending"
                  tone="info"
                  message={t('privacy.accountPending')}
                />
              )}
              {pending.map((p) => (
                <View
                  key={p.id}
                  testID={`pending-deletion-${p.scope === 'ACCOUNT' ? 'account' : p.studentId}`}
                  style={{
                    gap: theme.spacing.sm,
                    padding: theme.spacing.lg,
                    backgroundColor: c.surface,
                    borderRadius: theme.radii.lg,
                    borderWidth: 1,
                    borderColor: c.danger,
                  }}
                >
                  <Text style={[theme.typography.bodyStrong, { color: c.text }]}>
                    {p.scope === 'ACCOUNT'
                      ? t('privacy.pendingAccount')
                      : p.name
                        ? t('privacy.pendingChild', { name: p.name })
                        : t('privacy.pendingChildUnknown')}
                  </Text>
                  <Text style={[theme.typography.caption, { color: c.textMuted }]}>
                    {t('privacy.daysLeft', { date: formatDay(p.purgeAfter), n: p.daysLeft })}
                  </Text>
                  {/* A child's cancel needs the household, which is hidden while the account is pending. */}
                  {(p.scope === 'ACCOUNT' || (household && !accountPending)) && (
                    <Button
                      testID={`cancel-deletion-${p.scope === 'ACCOUNT' ? 'account' : p.studentId}`}
                      label={t('privacy.cancelDeletion')}
                      variant="secondary"
                      busy={busy}
                      onPress={() => cancelDeletion(p)}
                    />
                  )}
                </View>
              ))}
            </>
          );
          if (accountPending || !household) {
            return (
              <View style={{ gap: theme.spacing.md }}>
                {pendingSection}
                <Button
                  testID="privacy-sign-out"
                  label={t('children.signOut')}
                  variant="secondary"
                  onPress={() => void signOut()}
                />
              </View>
            );
          }
          return (
            <View style={{ gap: theme.spacing.md }}>
              {pendingSection}
              {section(t('privacy.children'))}
              {household.students.map((s) => (
                <Pressable
                  key={s.id}
                  testID={`privacy-child-${s.childLoginId}`}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/consents/[id]', params: { id: s.id } })}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    padding: theme.spacing.lg,
                    backgroundColor: c.surface,
                    borderRadius: theme.radii.lg,
                    borderWidth: 1,
                    borderColor: c.border,
                  }}
                >
                  <Text style={{ fontSize: 28 }}>{AVATAR_GLYPHS[s.avatar]}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[theme.typography.bodyStrong, { color: c.text }]}>
                      {s.displayName}
                    </Text>
                    <Text
                      style={[
                        theme.typography.caption,
                        { color: canChildSignIn(s) ? c.success : c.warning },
                      ]}
                    >
                      {s.deletionScheduledFor
                        ? t('consents.deletionScheduled', {
                            date: formatDay(s.deletionScheduledFor),
                          })
                        : canChildSignIn(s)
                          ? t('privacy.childOn')
                          : t('privacy.childOff')}
                    </Text>
                  </View>
                </Pressable>
              ))}

              {section(t('privacy.policies'))}
              {overview.acceptances.map((a) => (
                <Text key={`${a.type}-${a.version}`} style={{ color: c.text }}>
                  {t('privacy.policyLine', {
                    title: t(`policyType.${a.type}` as MessageKey),
                    v: a.version,
                    date: formatDay(a.acceptedAt),
                  })}
                </Text>
              ))}
              <Button
                testID="view-policies"
                label={t('privacy.viewPolicies')}
                variant="secondary"
                onPress={() => router.push({ pathname: '/policies', params: { view: '1' } })}
              />

              {section(t('privacy.export'))}
              <Text style={{ color: c.textMuted }}>{t('privacy.exportHint')}</Text>
              {shown && (shown.status === 'QUEUED' || shown.status === 'RUNNING') && (
                <Notice testID="export-status" tone="info" message={t('privacy.exportQueued')} />
              )}
              {shown?.status === 'READY' && shown.expiresAt && (
                <>
                  <Notice
                    testID="export-status"
                    tone="info"
                    message={t('privacy.exportReady', { time: formatDayTime(shown.expiresAt) })}
                  />
                  <Button
                    testID="export-download"
                    label={t('privacy.exportDownload')}
                    onPress={() => void download(shown)}
                  />
                </>
              )}
              {shown?.status === 'FAILED' && <Notice message={t('privacy.exportFailed')} />}
              <Button
                testID="export-start"
                label={t('privacy.exportStart')}
                variant={shown?.status === 'READY' ? 'secondary' : 'primary'}
                busy={busy}
                disabled={shown?.status === 'QUEUED' || shown?.status === 'RUNNING'}
                onPress={() => void startExport()}
              />

              {section(t('privacy.deleteAccount'))}
              <Text style={{ color: c.textMuted }}>
                {t('privacy.deleteAccountHint', { days: DELETION_GRACE_DAYS })}
              </Text>
              <Button
                testID="delete-account"
                label={t('privacy.deleteAccount')}
                variant="danger"
                disabled={busy}
                onPress={deleteAccount}
              />
            </View>
          );
        }}
      </StateView>
      {message && <Notice message={message.text} tone={message.tone} />}
    </Screen>
  );
}
