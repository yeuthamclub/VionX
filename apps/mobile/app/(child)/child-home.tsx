import type { TodayItem, TodayResponse } from '@vionx/contracts/client';
import * as Crypto from 'expo-crypto';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { childApi } from '../../src/api.ts';
import { t } from '../../src/i18n/index.ts';
import { AppError, describeError, unwrap } from '../../src/lib/api-error.ts';
import { pendingAssents } from '../../src/lib/consent.ts';
import { CameraDeniedError, takeAndUploadProof } from '../../src/lib/proof.ts';
import { capBar } from '../../src/lib/rewards.ts';
import { practiceParams, timeBar, todaySections } from '../../src/lib/today.ts';
import { childToken } from '../../src/state/device.ts';
import { useTheme } from '../../src/theme.ts';
import { AVATAR_GLYPHS } from '../../src/ui/avatars.ts';
import { Button } from '../../src/ui/Button.tsx';
import { ProgressBar } from '../../src/ui/CapBar.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { StateView } from '../../src/ui/StateView.tsx';
import { TodayCard } from '../../src/ui/TodayCard.tsx';
import { useLoad } from '../../src/ui/useLoad.ts';

/**
 * Child home = Today (M07): the day's cards in priority order with duration, reward hint and the
 * cap bar. Coming back from a practice session reloads the plan, so the finished item shows as
 * done without a manual refresh.
 */
export default function ChildHome() {
  const theme = useTheme();
  const c = theme.colors;
  const { state, reload, setState } = useLoad(async () => {
    try {
      const session = await unwrap(childApi.GET('/api/v1/auth/child/session'));
      const path = { id: session.student.id };
      const [today, pending, wallet] = await Promise.all([
        unwrap(childApi.GET('/api/v1/students/{id}/today', { params: { path } })),
        // Requests for the child's own agreement (age 7+); never blocks the home screen.
        unwrap(childApi.GET('/api/v1/students/{id}/consents', { params: { path } })).then(
          (r) => pendingAssents(r.consents).length,
          () => 0,
        ),
        // The cap bar is a hint; Today works without it.
        unwrap(childApi.GET('/api/v1/students/{id}/rewards/wallet', { params: { path } })).catch(
          () => null,
        ),
      ]);
      return { ...session, today, pending, wallet };
    } catch (e) {
      if (e instanceof AppError && e.status === 401) {
        await childToken.clear();
        router.replace('/child');
      }
      throw e;
    }
  });
  const pendingUuids = useRef(new Map<string, string>());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);

  // Back from a session, the tasks list or the wallet: read the plan again.
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) reload();
      focused.current = true;
    }, [reload]),
  );

  const setToday = (today: TodayResponse) =>
    setState((s) => (s.kind === 'ready' ? { kind: 'ready', data: { ...s.data, today } } : s));

  const run = async (item: TodayItem, action: () => Promise<void>) => {
    setBusyId(item.id);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      setMessage({
        text: e instanceof CameraDeniedError ? t('childTasks.cameraDenied') : describeError(e),
        tone: 'error',
      });
    } finally {
      setBusyId(null);
    }
  };
  const path = (item: TodayItem) => ({ params: { path: { id: item.id } } });

  const start = (item: TodayItem) =>
    run(item, async () => {
      const params = practiceParams(item.link);
      if (!params) return;
      const res = await unwrap(childApi.POST('/api/v1/today-items/{id}/start', path(item)));
      setToday(res.today);
      router.push({ pathname: '/practice', params });
    });

  const complete = (item: TodayItem) =>
    run(item, async () => {
      if (item.link.type !== 'TASK') return;
      let proofPath: string | undefined;
      if (item.link.verificationMode === 'PHOTO_PROOF') {
        const uploaded = await takeAndUploadProof(item.link.taskId);
        if (!uploaded) return;
        proofPath = uploaded;
      }
      // The clientUuid is kept until the server answers, so a retry is recorded once.
      const clientUuid = pendingUuids.current.get(item.id) ?? Crypto.randomUUID();
      pendingUuids.current.set(item.id, clientUuid);
      try {
        const res = await unwrap(
          childApi.POST('/api/v1/today-items/{id}/complete', {
            ...path(item),
            body: { clientUuid, ...(proofPath ? { proofPath } : {}) },
          }),
        );
        pendingUuids.current.delete(item.id);
        setToday(res.today);
        setMessage({
          text: res.item.status === 'DONE' ? t('today.great') : t('today.sent'),
          tone: 'info',
        });
      } catch (e) {
        if (!(e instanceof AppError && e.kind === 'offline')) pendingUuids.current.delete(item.id);
        throw e;
      }
    });

  const skip = (item: TodayItem) =>
    run(item, async () => {
      const res = await unwrap(childApi.POST('/api/v1/today-items/{id}/skip', path(item)));
      setToday(res.today);
    });

  const signOut = async () => {
    try {
      await unwrap(childApi.POST('/api/v1/auth/child/logout'));
    } catch {
      // Offline or already revoked: the local token is removed either way.
    }
    await childToken.clear();
    router.replace('/child');
  };

  const cards = (title: string, items: TodayItem[], testID: string) =>
    items.length > 0 && (
      <View testID={testID} style={{ gap: theme.spacing.md }}>
        <Text style={[theme.typography.heading, { color: c.text }]}>{title}</Text>
        {items.map((item) => (
          <TodayCard
            key={item.id}
            item={item}
            mode="child"
            busy={busyId === item.id}
            onStart={() => void start(item)}
            onComplete={() => void complete(item)}
            onSkip={() => void skip(item)}
          />
        ))}
      </View>
    );

  return (
    <Screen testID="screen-child-home">
      <StateView state={state} reload={reload}>
        {(home) => {
          const sections = todaySections(home.today);
          const time = timeBar(home.today);
          const cap = home.wallet ? capBar(home.wallet.todayCap) : null;
          return (
            <View style={{ gap: theme.spacing.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Text style={{ fontSize: 48 }}>{AVATAR_GLYPHS[home.student.avatar]}</Text>
                <Text
                  testID="child-greeting"
                  style={[theme.typography.title, { color: c.text, flex: 1 }]}
                >
                  {t('childHome.hello', { name: home.student.displayName })}
                </Text>
              </View>
              {home.pending > 0 && (
                <View style={{ gap: theme.spacing.sm }}>
                  <Notice
                    testID="assent-pending"
                    tone="info"
                    message={t('childHome.assentPending', { n: home.pending })}
                  />
                  <Button
                    testID="open-assent"
                    label={t('childHome.assentOpen')}
                    color={c.child}
                    onPress={() => router.push('/assent')}
                  />
                </View>
              )}
              <Text style={[theme.typography.heading, { color: c.text }]}>{t('today.title')}</Text>
              <ProgressBar
                testID="today-time-bar"
                fraction={time.fraction}
                caption={time.caption}
                color={c.child}
              />
              {cap && (
                <ProgressBar
                  testID="today-cap-bar"
                  fraction={cap.fraction}
                  caption={cap.caption}
                  color={home.wallet!.todayCap.reached ? c.success : c.reward}
                />
              )}
              {message && (
                <Notice message={message.text} tone={message.tone} testID="today-message" />
              )}
              {home.today.items.length === 0 && (
                <Text
                  testID="today-empty"
                  style={[theme.typography.childBody, { color: c.textMuted }]}
                >
                  {t('today.empty')}
                </Text>
              )}
              {cards(t('today.now'), sections.now, 'today-now')}
              {cards(t('today.later'), sections.later, 'today-later')}
              {cards(t('today.done'), sections.done, 'today-done')}
            </View>
          );
        }}
      </StateView>
      <Button
        testID="open-learn"
        label={t('learn.open')}
        color={c.child}
        onPress={() => router.push('/learn')}
      />
      <Button
        testID="open-child-tasks"
        label={t('childTasks.open')}
        variant="secondary"
        onPress={() => router.push('/tasks')}
      />
      <Button
        testID="open-child-wallet"
        label={t('wallet.open')}
        color={c.reward}
        onPress={() => router.push('/wallet')}
      />
      <Button
        testID="child-sign-out"
        label={t('childHome.signOut')}
        variant="secondary"
        onPress={() => void signOut()}
      />
    </Screen>
  );
}
