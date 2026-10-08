import type { ConsentType } from '@vionx/contracts/client';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { childApi } from '../../src/api.ts';
import { t, type MessageKey } from '../../src/i18n/index.ts';
import { describeError, unwrap } from '../../src/lib/api-error.ts';
import { pendingAssents } from '../../src/lib/consent.ts';
import { useTheme } from '../../src/theme.ts';
import { Button } from '../../src/ui/Button.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { StateView } from '../../src/ui/StateView.tsx';
import { useLoad } from '../../src/ui/useLoad.ts';

/** Child assent (age 7+): the child agrees or declines each feature a parent turned on. */
export default function Assent() {
  const theme = useTheme();
  const c = theme.colors;
  const { state, reload } = useLoad(async () => {
    const session = await unwrap(childApi.GET('/api/v1/auth/child/session'));
    const consents = await unwrap(
      childApi.GET('/api/v1/students/{id}/consents', {
        params: { path: { id: session.student.id } },
      }),
    );
    return { studentId: session.student.id, pending: pendingAssents(consents.consents) };
  });
  const [answered, setAnswered] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answer = async (studentId: string, type: ConsentType, decision: 'GIVEN' | 'DECLINED') => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(
        childApi.POST('/api/v1/students/{id}/consents/{type}/child-assent', {
          params: { path: { id: studentId, type } },
          body: { decision },
        }),
      );
      setAnswered((n) => n + 1);
      reload();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('assent.title')} testID="screen-assent">
      <StateView state={state} reload={reload}>
        {({ studentId, pending }) =>
          pending.length === 0 ? (
            <View style={{ gap: theme.spacing.lg }}>
              <Text
                testID="assent-done"
                style={[theme.typography.childBody, { color: c.text, textAlign: 'center' }]}
              >
                {answered > 0 ? t('assent.thanks') : t('assent.none')}
              </Text>
              <Button
                testID="assent-back"
                label={t('common.done')}
                color={c.child}
                onPress={() => router.replace('/child-home')}
              />
            </View>
          ) : (
            <View
              testID={`assent-${pending[0]}`}
              style={{
                gap: theme.spacing.lg,
                padding: theme.spacing.xl,
                backgroundColor: c.surface,
                borderRadius: theme.radii.lg,
                borderWidth: 1,
                borderColor: c.border,
              }}
            >
              <Text style={[theme.typography.childBody, { color: c.text }]}>
                {t(`assent.${pending[0]}` as MessageKey)}
              </Text>
              <Button
                testID="assent-yes"
                label={t('assent.yes')}
                color={c.child}
                busy={busy}
                onPress={() => void answer(studentId, pending[0]!, 'GIVEN')}
              />
              <Button
                testID="assent-no"
                label={t('assent.no')}
                variant="secondary"
                disabled={busy}
                onPress={() => void answer(studentId, pending[0]!, 'DECLINED')}
              />
            </View>
          )
        }
      </StateView>
      <Notice message={error} />
    </Screen>
  );
}
