import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import type { HouseholdResponse, Student } from '@vionx/contracts/client';
import { parentApi } from '../../src/api.ts';
import { t, type MessageKey } from '../../src/i18n/index.ts';
import { AppError, isAccountDeletionPending, unwrap } from '../../src/lib/api-error.ts';
import { childToken, deviceMode } from '../../src/state/device.ts';
import { signOutGoogle } from '../../src/state/google.ts';
import { signOutParent } from '../../src/state/supabase.ts';
import { useTheme } from '../../src/theme.ts';
import { AVATAR_GLYPHS } from '../../src/ui/avatars.ts';
import { Button } from '../../src/ui/Button.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { StateView } from '../../src/ui/StateView.tsx';
import { useLoad } from '../../src/ui/useLoad.ts';

/** Parent home: the household's children, add child, child-device mode, sign out. */
export default function ParentHome() {
  const theme = useTheme();
  const c = theme.colors;
  const { state, reload } = useLoad(async (): Promise<HouseholdResponse | null> => {
    try {
      return await unwrap(parentApi.GET('/api/v1/household'));
    } catch (e) {
      if (e instanceof AppError && e.status === 404) return null;
      if (isAccountDeletionPending(e)) router.replace('/privacy');
      if (e instanceof AppError && e.status === 401) {
        router.replace('/sign-in');
      }
      throw e;
    }
  });
  // Refresh when coming back from add/detail screens (the first focus is the initial load).
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) reload();
      focused.current = true;
    }, [reload]),
  );

  const noHousehold = state.kind === 'ready' && state.data === null;
  useEffect(() => {
    if (noHousehold) router.replace('/household-new');
  }, [noHousehold]);

  const signOut = async () => {
    await signOutGoogle();
    await signOutParent();
    router.replace('/welcome');
  };

  const useAsChildDevice = () =>
    Alert.alert(t('children.childDevice'), t('children.childDeviceConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.continue'),
        onPress: () =>
          void (async () => {
            await deviceMode.set('child');
            await childToken.clear();
            await signOutGoogle();
            await signOutParent();
            router.replace('/child');
          })(),
      },
    ]);

  const StudentRow = ({ s }: { s: Student }) => (
    <Pressable
      testID={`student-${s.childLoginId}`}
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/students/[id]', params: { id: s.id } })}
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
      <Text style={{ fontSize: 32 }}>{AVATAR_GLYPHS[s.avatar]}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[theme.typography.bodyStrong, { color: c.text }]}>{s.displayName}</Text>
        <Text style={[theme.typography.caption, { color: c.textMuted }]}>
          {t('children.grade', { n: s.grade })} · {s.childLoginId}
        </Text>
      </View>
      <Text
        style={[
          theme.typography.caption,
          {
            color:
              s.status === 'active' && s.coreServiceConsent
                ? c.success
                : s.status === 'disabled'
                  ? c.danger
                  : c.warning,
          },
        ]}
      >
        {s.status === 'active' && !s.coreServiceConsent
          ? t('children.needsConsent')
          : t(`children.status.${s.status}` as MessageKey)}
      </Text>
    </Pressable>
  );

  return (
    <Screen
      title={state.kind === 'ready' && state.data ? state.data.household.name : t('children.title')}
      testID="screen-parent-home"
    >
      <StateView
        state={state}
        reload={reload}
        isEmpty={(data) => (data?.students.length ?? 0) === 0}
        empty={<Text style={{ color: c.textMuted }}>{t('children.empty')}</Text>}
      >
        {(data) => (
          <View style={{ gap: theme.spacing.md }}>
            {data!.students.map((s) => (
              <StudentRow key={s.id} s={s} />
            ))}
          </View>
        )}
      </StateView>
      <Button
        testID="add-child"
        label={t('children.add')}
        color={c.parent}
        onPress={() => router.push('/child-new')}
      />
      <Button
        testID="privacy-center"
        label={t('children.privacy')}
        variant="secondary"
        onPress={() => router.push('/privacy')}
      />
      <Button
        testID="child-device"
        label={t('children.childDevice')}
        variant="secondary"
        onPress={useAsChildDevice}
      />
      <Button
        testID="parent-sign-out"
        label={t('children.signOut')}
        variant="secondary"
        onPress={() => void signOut()}
      />
    </Screen>
  );
}
