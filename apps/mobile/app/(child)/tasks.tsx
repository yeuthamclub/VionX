import type { TaskOccurrence } from '@vionx/contracts/client';
import { DEFAULT_HOUSEHOLD_TIMEZONE, householdToday } from '@vionx/domain';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { childApi } from '../../src/api.ts';
import { t } from '../../src/i18n/index.ts';
import { AppError, describeError, unwrap } from '../../src/lib/api-error.ts';
import { CameraDeniedError, takeAndUploadProof } from '../../src/lib/proof.ts';
import { childToken } from '../../src/state/device.ts';
import { useTheme } from '../../src/theme.ts';
import { Notice } from '../../src/ui/Notice.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { StateView } from '../../src/ui/StateView.tsx';
import { TaskCard } from '../../src/ui/TaskCard.tsx';
import { useLoad } from '../../src/ui/useLoad.ts';

/**
 * Child: today's tasks (replaced by Today in M07). "Done" completes the day; PHOTO_PROOF tasks open
 * the camera first. Each attempt keeps its clientUuid until the server answers, so a retry after a
 * lost response is recorded once.
 */
export default function ChildTasks() {
  const theme = useTheme();
  const { state, reload, setState } = useLoad(async () => {
    try {
      const session = await unwrap(childApi.GET('/api/v1/auth/child/session'));
      const today = householdToday(new Date(), DEFAULT_HOUSEHOLD_TIMEZONE);
      return await unwrap(
        childApi.GET('/api/v1/students/{id}/calendar', {
          params: { path: { id: session.student.id }, query: { from: today, to: today } },
        }),
      );
    } catch (e) {
      if (e instanceof AppError && e.status === 401) {
        await childToken.clear();
        router.replace('/child');
      }
      throw e;
    }
  });
  const pending = useRef(new Map<string, string>());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);

  const complete = async (o: TaskOccurrence) => {
    setBusyId(o.id);
    setMessage(null);
    try {
      let proofPath: string | undefined;
      if (o.verificationMode === 'PHOTO_PROOF') {
        const path = await takeAndUploadProof(o.taskId);
        if (!path) return;
        proofPath = path;
      }
      const clientUuid = pending.current.get(o.id) ?? Crypto.randomUUID();
      pending.current.set(o.id, clientUuid);
      const res = await unwrap(
        childApi.POST('/api/v1/tasks/{id}/complete', {
          params: { path: { id: o.taskId } },
          body: { clientUuid, date: o.date, ...(proofPath ? { proofPath } : {}) },
        }),
      );
      pending.current.delete(o.id);
      setState((s) =>
        s.kind === 'ready'
          ? {
              kind: 'ready',
              data: {
                ...s.data,
                tasks: s.data.tasks.map((x) => (x.id === o.id ? res.occurrence : x)),
              },
            }
          : s,
      );
      setMessage({
        text: res.occurrence.status === 'COMPLETED' ? t('childTasks.great') : t('childTasks.sent'),
        tone: 'info',
      });
    } catch (e) {
      // Offline: keep the clientUuid for the retry. A refused completion gets a fresh one next time.
      if (!(e instanceof AppError && e.kind === 'offline')) pending.current.delete(o.id);
      setMessage({
        text: e instanceof CameraDeniedError ? t('childTasks.cameraDenied') : describeError(e),
        tone: 'error',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen title={t('childTasks.title')} testID="screen-child-tasks">
      {message && (
        <Notice message={message.text} tone={message.tone} testID="child-tasks-message" />
      )}
      <StateView
        state={state}
        reload={reload}
        isEmpty={(cal) => cal.tasks.length === 0}
        empty={
          <Text
            testID="child-tasks-empty"
            style={[theme.typography.childBody, { color: theme.colors.textMuted }]}
          >
            {t('childTasks.empty')}
          </Text>
        }
      >
        {(cal) => (
          <View style={{ gap: theme.spacing.md }}>
            {cal.tasks.map((o) => (
              <TaskCard
                key={o.id}
                occurrence={o}
                today={cal.today}
                mode="child"
                busy={busyId === o.id}
                onComplete={() => void complete(o)}
              />
            ))}
          </View>
        )}
      </StateView>
    </Screen>
  );
}
