import { normalizeLoginId } from '@vionx/domain';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api } from '../../src/api.ts';
import { t } from '../../src/i18n/index.ts';
import { describeError, unwrap } from '../../src/lib/api-error.ts';
import { canSubmitPin } from '../../src/lib/pin-pad.ts';
import { childToken, getDeviceId, rememberedLoginId } from '../../src/state/device.ts';
import { useTheme } from '../../src/theme.ts';
import { Button } from '../../src/ui/Button.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { PinKeypad } from '../../src/ui/PinKeypad.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { TextField } from '../../src/ui/TextField.tsx';

/** Child sign-in: login id (remembered on this device) + PIN keypad. */
export default function ChildLogin() {
  const theme = useTheme();
  const c = theme.colors;
  const [remembered, setRemembered] = useState<string | null>(null);
  const [loginId, setLoginId] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void rememberedLoginId.get().then((id) => {
      if (id) {
        setRemembered(id);
        setLoginId(id);
      }
    });
  }, []);

  const submit = async () => {
    const id = normalizeLoginId(loginId);
    if (!id) return setError(t('childLogin.invalidId'));
    setBusy(true);
    setError(null);
    try {
      const res = await unwrap(
        api.POST('/api/v1/auth/child/login', {
          body: { childLoginId: id, pin, deviceId: await getDeviceId() },
        }),
      );
      await childToken.set(res.token);
      await rememberedLoginId.set(id);
      router.replace('/child-home');
    } catch (e) {
      setPin('');
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    await rememberedLoginId.clear();
    setRemembered(null);
    setLoginId('');
    setPin('');
  };

  return (
    <Screen title={t('childLogin.title')} testID="screen-child-login">
      {remembered ? (
        <View style={{ gap: theme.spacing.xs }}>
          <Text style={[theme.typography.caption, { color: c.textMuted }]}>
            {t('childLogin.loginId')}
          </Text>
          <Text testID="remembered-login-id" style={[theme.typography.title, { color: c.text }]}>
            {remembered}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void forget()}>
            <Text style={{ color: c.primary }}>{t('childLogin.notYou')}</Text>
          </Pressable>
        </View>
      ) : (
        <TextField
          testID="child-login-id"
          label={t('childLogin.loginId')}
          placeholder={t('childLogin.loginIdPlaceholder')}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={12}
          value={loginId}
          onChangeText={setLoginId}
          style={theme.typography.childBody}
        />
      )}
      <PinKeypad value={pin} onChange={setPin} disabled={busy} />
      <Notice testID="child-login-error" message={error} />
      <Button
        testID="child-login-submit"
        label={t('childLogin.submit')}
        color={c.child}
        busy={busy}
        disabled={!canSubmitPin(pin) || !loginId.trim()}
        onPress={() => void submit()}
      />
      <Pressable
        testID="child-login-parent"
        accessibilityRole="button"
        onPress={() => router.push('/sign-in')}
        style={{ alignSelf: 'center', padding: theme.spacing.md }}
      >
        <Text style={{ color: c.textMuted }}>{t('childLogin.parent')}</Text>
      </Pressable>
    </Screen>
  );
}
