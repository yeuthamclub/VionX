import { useState } from 'react';
import { Text, View } from 'react-native';
import { t } from '../../src/i18n/index.ts';
import { AppError, describeError } from '../../src/lib/api-error.ts';
import { formatVnPhone, toE164Vn } from '../../src/lib/phone.ts';
import { googleSignInAvailable, signInWithGoogle } from '../../src/state/google.ts';
import { routeSignedInParent } from '../../src/state/session.ts';
import { sendPhoneOtp, verifyPhoneOtp } from '../../src/state/supabase.ts';
import { useTheme } from '../../src/theme.ts';
import { Button } from '../../src/ui/Button.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { TextField } from '../../src/ui/TextField.tsx';

/** Parent sign-in: phone OTP (Supabase Auth) or native Google Sign-In. */
export default function ParentSignIn() {
  const theme = useTheme();
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      // AppError comes from our api; Supabase Auth errors get the step's message.
      const network =
        e instanceof TypeError || (e instanceof Error && e.name === 'AuthRetryableFetchError');
      setError(e instanceof AppError ? describeError(e) : network ? t('error.offline') : fallback);
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () => {
    const e164 = toE164Vn(phoneInput);
    if (!e164) return setError(t('signIn.invalidPhone'));
    void run(async () => {
      await sendPhoneOtp(e164);
      setPhone(e164);
    }, t('error.generic'));
  };

  const verify = () =>
    void run(async () => {
      await verifyPhoneOtp(phone!, code.trim());
      await routeSignedInParent();
    }, t('signIn.invalidCode'));

  const google = () =>
    void run(async () => {
      if (await signInWithGoogle()) await routeSignedInParent();
    }, t('error.generic'));

  return (
    <Screen title={t('signIn.title')} testID="screen-sign-in">
      {phone === null ? (
        <>
          <TextField
            testID="phone-input"
            label={t('signIn.phoneLabel')}
            placeholder={t('signIn.phonePlaceholder')}
            keyboardType="phone-pad"
            autoComplete="tel"
            value={phoneInput}
            onChangeText={setPhoneInput}
          />
          <Button testID="send-code" label={t('signIn.sendCode')} busy={busy} onPress={sendCode} />
        </>
      ) : (
        <>
          <Text style={{ color: theme.colors.textMuted }}>
            {t('signIn.codeSent', { phone: formatVnPhone(phone) })}
          </Text>
          <TextField
            testID="otp-input"
            label={t('signIn.codeLabel')}
            keyboardType="number-pad"
            autoComplete="sms-otp"
            maxLength={6}
            value={code}
            onChangeText={setCode}
          />
          <Button
            testID="verify-code"
            label={t('signIn.verify')}
            busy={busy}
            disabled={code.trim().length !== 6}
            onPress={verify}
          />
          <Button
            label={t('signIn.changePhone')}
            variant="secondary"
            onPress={() => setPhone(null)}
          />
        </>
      )}
      <Notice testID="sign-in-error" message={error} />
      <View style={{ alignItems: 'center' }}>
        <Text style={{ color: theme.colors.textMuted }}>{t('signIn.or')}</Text>
      </View>
      <Button
        testID="google-sign-in"
        label={t('signIn.google')}
        variant="secondary"
        disabled={busy}
        onPress={googleSignInAvailable ? google : () => setError(t('signIn.googleUnavailable'))}
      />
    </Screen>
  );
}
