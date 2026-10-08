import type { Student } from '@vionx/contracts/client';
import { PIN_PATTERN } from '@vionx/domain';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { parentApi } from '../../../src/api.ts';
import { t, type MessageKey } from '../../../src/i18n/index.ts';
import { describeError, unwrap } from '../../../src/lib/api-error.ts';
import { holdCredentials } from '../../../src/state/credentials.ts';
import { useTheme } from '../../../src/theme.ts';
import { AVATAR_GLYPHS } from '../../../src/ui/avatars.ts';
import { Button } from '../../../src/ui/Button.tsx';
import { Notice } from '../../../src/ui/Notice.tsx';
import { Screen } from '../../../src/ui/Screen.tsx';
import { TextField } from '../../../src/ui/TextField.tsx';
import { StateView } from '../../../src/ui/StateView.tsx';
import { useLoad } from '../../../src/ui/useLoad.ts';

/** Child detail: status, reset PIN (new credential card), sign out everywhere, turn off/on. */
export default function StudentDetail() {
  const theme = useTheme();
  const c = theme.colors;
  const { id } = useLocalSearchParams<{ id: string }>();
  const path = { params: { path: { id } } };
  const { state, reload, setState } = useLoad(
    () => unwrap(parentApi.GET('/api/v1/students/{id}', path)),
    [id],
  );
  const [busy, setBusy] = useState(false);
  const [newPin, setNewPin] = useState('');
  const newPinOk = newPin === '' || PIN_PATTERN.test(newPin);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      setMessage({ text: describeError(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const confirm = (title: string, body: string, onConfirm: () => void) =>
    Alert.alert(title, body, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.continue'), style: 'destructive', onPress: onConfirm },
    ]);

  const resetPin = (s: Student) =>
    confirm(
      t('student.resetPin'),
      t('student.resetPinConfirm', { name: s.displayName }),
      () =>
        void act(async () => {
          const res = await unwrap(
            parentApi.POST('/api/v1/students/{id}/reset-pin', {
              ...path,
              body: newPin ? { pin: newPin } : {},
            }),
          );
          setNewPin('');
          holdCredentials({ ...res.credentials, displayName: s.displayName });
          router.push('/credentials');
        }),
    );

  const revoke = () =>
    void act(async () => {
      const res = await unwrap(parentApi.POST('/api/v1/students/{id}/revoke-sessions', path));
      setMessage({ text: t('student.revokeDone', { n: res.revokedSessions }), tone: 'info' });
      reload();
    });

  const toggle = (s: Student) => {
    const disable = s.status !== 'disabled';
    const run = () =>
      void act(async () => {
        const updated = await unwrap(
          parentApi.POST('/api/v1/students/{id}/disable', { ...path, body: { disabled: disable } }),
        );
        setState({ kind: 'ready', data: updated });
      });
    if (disable)
      confirm(t('student.disable'), t('student.disableConfirm', { name: s.displayName }), run);
    else run();
  };

  return (
    <Screen title={t('student.title')} testID="screen-student">
      <StateView state={state} reload={reload}>
        {(s) => (
          <View style={{ gap: theme.spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Text style={{ fontSize: 48 }}>{AVATAR_GLYPHS[s.avatar]}</Text>
              <View>
                <Text style={[theme.typography.heading, { color: c.text }]}>{s.displayName}</Text>
                <Text style={{ color: c.textMuted }}>
                  {t('children.grade', { n: s.grade })} · {s.birthYear}
                </Text>
              </View>
            </View>
            <Text testID="student-login-id" style={{ color: c.text }}>
              {t('student.loginId', { id: s.childLoginId })}
            </Text>
            <Text
              testID="student-status"
              style={{ color: s.status === 'active' ? c.success : c.warning }}
            >
              {t(`children.status.${s.status}` as MessageKey)}
              {s.lockedUntil
                ? ` · ${t('student.lockedUntil', { time: new Date(s.lockedUntil).toLocaleTimeString('vi-VN') })}`
                : ''}
            </Text>
            <Text style={{ color: c.textMuted }}>
              {t('student.sessions', { n: s.activeSessions })}
            </Text>
            <TextField
              testID="new-pin"
              label={t('childNew.pin')}
              keyboardType="number-pad"
              maxLength={8}
              secureTextEntry
              value={newPin}
              onChangeText={setNewPin}
              error={newPinOk ? null : t('error.validation')}
            />
            <Button
              testID="reset-pin"
              label={t('student.resetPin')}
              busy={busy}
              disabled={!newPinOk}
              onPress={() => resetPin(s)}
            />
            <Button
              testID="revoke-sessions"
              label={t('student.revoke')}
              variant="secondary"
              disabled={busy}
              onPress={revoke}
            />
            <Button
              testID="toggle-disabled"
              label={s.status === 'disabled' ? t('student.enable') : t('student.disable')}
              variant={s.status === 'disabled' ? 'secondary' : 'danger'}
              disabled={busy}
              onPress={() => toggle(s)}
            />
          </View>
        )}
      </StateView>
      {message && <Notice message={message.text} tone={message.tone} />}
    </Screen>
  );
}
