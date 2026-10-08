import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { childApi } from '../../src/api.ts';
import { t } from '../../src/i18n/index.ts';
import { AppError, unwrap } from '../../src/lib/api-error.ts';
import { pendingAssents } from '../../src/lib/consent.ts';
import { childToken } from '../../src/state/device.ts';
import { useTheme } from '../../src/theme.ts';
import { AVATAR_GLYPHS } from '../../src/ui/avatars.ts';
import { Button } from '../../src/ui/Button.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { StateView } from '../../src/ui/StateView.tsx';
import { useLoad } from '../../src/ui/useLoad.ts';

/** Child home placeholder (Today arrives with M07): greeting, pending assent requests, sign-out. */
export default function ChildHome() {
  const theme = useTheme();
  const { state, reload } = useLoad(async () => {
    try {
      const session = await unwrap(childApi.GET('/api/v1/auth/child/session'));
      // Requests for the child's own agreement (age 7+); never blocks the home screen.
      const pending = await unwrap(
        childApi.GET('/api/v1/students/{id}/consents', {
          params: { path: { id: session.student.id } },
        }),
      ).then(
        (c) => pendingAssents(c.consents).length,
        () => 0,
      );
      return { ...session, pending };
    } catch (e) {
      if (e instanceof AppError && e.status === 401) {
        await childToken.clear();
        router.replace('/child');
      }
      throw e;
    }
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

  return (
    <Screen testID="screen-child-home">
      <StateView state={state} reload={reload}>
        {(session) => (
          <View
            style={{ alignItems: 'center', gap: theme.spacing.md, paddingTop: theme.spacing.xxl }}
          >
            <Text style={{ fontSize: 72 }}>{AVATAR_GLYPHS[session.student.avatar]}</Text>
            <Text
              testID="child-greeting"
              style={[theme.typography.title, { color: theme.colors.text }]}
            >
              {t('childHome.hello', { name: session.student.displayName })}
            </Text>
            <Text
              style={[
                theme.typography.childBody,
                { color: theme.colors.textMuted, textAlign: 'center' },
              ]}
            >
              {t('childHome.subtitle', { n: session.student.grade })}
            </Text>
            {session.pending > 0 && (
              <View style={{ gap: theme.spacing.sm, alignSelf: 'stretch' }}>
                <Notice
                  testID="assent-pending"
                  tone="info"
                  message={t('childHome.assentPending', { n: session.pending })}
                />
                <Button
                  testID="open-assent"
                  label={t('childHome.assentOpen')}
                  color={theme.colors.child}
                  onPress={() => router.push('/assent')}
                />
              </View>
            )}
          </View>
        )}
      </StateView>
      <Button
        testID="child-sign-out"
        label={t('childHome.signOut')}
        variant="secondary"
        onPress={() => void signOut()}
      />
    </Screen>
  );
}
