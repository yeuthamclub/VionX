import type { ConsentState, ConsentType } from '@vionx/contracts/client';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { parentApi } from '../../../src/api.ts';
import { t, type MessageKey } from '../../../src/i18n/index.ts';
import { AppError, describeError, unwrap } from '../../../src/lib/api-error.ts';
import { consentTitleKey, formatDay } from '../../../src/lib/consent.ts';
import { getDeviceId } from '../../../src/state/device.ts';
import { useTheme } from '../../../src/theme.ts';
import { Button } from '../../../src/ui/Button.tsx';
import { ConsentRow } from '../../../src/ui/ConsentRow.tsx';
import { Notice } from '../../../src/ui/Notice.tsx';
import { Screen } from '../../../src/ui/Screen.tsx';
import { StateView } from '../../../src/ui/StateView.tsx';
import { useLoad } from '../../../src/ui/useLoad.ts';

/**
 * A child's consents: one row per type with turn on / off, the history, and deletion of the
 * child's profile. `?onboarding=1` is the step right after adding a child: CORE_SERVICE must be on
 * before the credential card is shown.
 */
export default function ChildConsents() {
  const theme = useTheme();
  const c = theme.colors;
  const { id, onboarding } = useLocalSearchParams<{ id: string; onboarding?: string }>();
  const isOnboarding = onboarding === '1';
  const path = { params: { path: { id } } };
  const { state, reload } = useLoad(async () => {
    const [student, consents] = await Promise.all([
      unwrap(parentApi.GET('/api/v1/students/{id}', path)),
      unwrap(parentApi.GET('/api/v1/students/{id}/consents', path)),
    ]);
    return { student, consents };
  }, [id]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      reload();
    } catch (e) {
      if (e instanceof AppError && e.code === 'CONFLICT') {
        setMessage({ text: t('error.policyChanged'), tone: 'error' });
        reload();
      } else {
        setMessage({ text: describeError(e), tone: 'error' });
      }
    } finally {
      setBusy(false);
    }
  };

  const grant = (type: ConsentType, policyVersion: number) =>
    void act(async () => {
      await unwrap(
        parentApi.POST('/api/v1/students/{id}/consents/{type}/grant', {
          params: { path: { id, type } },
          body: { policyVersion, deviceId: await getDeviceId() },
        }),
      );
    });

  const revoke = (s: ConsentState, name: string) => {
    const title = t(consentTitleKey(s.type));
    Alert.alert(
      title,
      s.type === 'CORE_SERVICE'
        ? t('consents.revokeCoreConfirm', { name })
        : t('consents.revokeConfirm', { title, name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('consents.turnOff'),
          style: 'destructive',
          onPress: () =>
            void act(async () => {
              await unwrap(
                parentApi.POST('/api/v1/students/{id}/consents/{type}/revoke', {
                  params: { path: { id, type: s.type } },
                  body: { deviceId: await getDeviceId() },
                }),
              );
            }),
        },
      ],
    );
  };

  const deleteChild = (name: string) =>
    Alert.alert(t('consents.deleteChild'), t('consents.deleteChildConfirm', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.continue'),
        style: 'destructive',
        onPress: () =>
          void act(async () => {
            const res = await unwrap(
              parentApi.POST('/api/v1/students/{id}/delete-request', {
                ...path,
                body: { confirm: true, source: 'app' },
              }),
            );
            setMessage({
              text: t('consents.deletionScheduled', { date: formatDay(res.deletion.purgeAfter) }),
              tone: 'info',
            });
          }),
      },
    ]);

  const name = state.kind === 'ready' ? state.data.student.displayName : '';
  return (
    <Screen
      title={t('consents.title', { name })}
      subtitle={isOnboarding ? t('consents.onboarding', { name }) : undefined}
      testID="screen-consents"
    >
      <StateView state={state} reload={reload}>
        {({ student, consents }) => {
          const core = consents.consents.find((s) => s.type === 'CORE_SERVICE')!;
          return (
            <View style={{ gap: theme.spacing.md }}>
              {student.deletionScheduledFor && (
                <Notice
                  tone="info"
                  message={t('consents.deletionScheduled', {
                    date: formatDay(student.deletionScheduledFor),
                  })}
                />
              )}
              <Text style={[theme.typography.caption, { color: c.textMuted }]}>
                {t('consents.policyVersion', { v: consents.policy.currentVersion })}
              </Text>
              {(isOnboarding ? [core] : consents.consents).map((s) => (
                <ConsentRow
                  key={s.type}
                  state={s}
                  busy={busy || Boolean(student.deletionScheduledFor)}
                  onGrant={() => grant(s.type, consents.policy.currentVersion)}
                  onRevoke={() => revoke(s, student.displayName)}
                />
              ))}
              {isOnboarding ? (
                <>
                  {!core.effective && <Notice tone="info" message={t('consents.coreRequired')} />}
                  <Button
                    testID="consent-continue"
                    label={t('consents.continue')}
                    disabled={!core.effective}
                    onPress={() => router.replace('/credentials')}
                  />
                </>
              ) : (
                <>
                  <Text style={[theme.typography.heading, { color: c.text }]}>
                    {t('consents.history')}
                  </Text>
                  {consents.history.length === 0 ? (
                    <Text style={{ color: c.textMuted }}>{t('consents.historyEmpty')}</Text>
                  ) : (
                    consents.history.map((r) => (
                      <Text key={r.id} style={[theme.typography.caption, { color: c.text }]}>
                        {t('consents.historyLine', {
                          date: formatDay(r.revokedAt ?? r.grantedAt),
                          title: t(consentTitleKey(r.consentType)),
                          status: t(`consent.record.${r.status}` as MessageKey),
                        })}
                      </Text>
                    ))
                  )}
                  {!student.deletionScheduledFor && (
                    <Button
                      testID="delete-child"
                      label={t('consents.deleteChild')}
                      variant="danger"
                      disabled={busy}
                      onPress={() => deleteChild(student.displayName)}
                    />
                  )}
                </>
              )}
            </View>
          );
        }}
      </StateView>
      {message && <Notice testID="consents-message" message={message.text} tone={message.tone} />}
    </Screen>
  );
}
