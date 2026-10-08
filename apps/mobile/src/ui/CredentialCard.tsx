import { forwardRef } from 'react';
import { Text, View } from 'react-native';
import { t } from '../i18n/index.ts';
import { useTheme } from '../theme.ts';

/** The one-time login card (captured as an image for sharing). */
export const CredentialCard = forwardRef<
  View,
  { displayName: string; childLoginId: string; pin: string }
>(function CredentialCard(props, ref) {
  const theme = useTheme();
  const c = theme.colors;
  return (
    <View
      ref={ref}
      collapsable={false}
      testID="credential-card"
      style={{
        backgroundColor: c.surface,
        borderRadius: theme.radii.xl,
        borderWidth: 2,
        borderColor: c.child,
        padding: theme.spacing.xl,
        gap: theme.spacing.md,
      }}
    >
      <Text style={[theme.typography.heading, { color: c.text }]}>VionX · {props.displayName}</Text>
      <View>
        <Text style={[theme.typography.caption, { color: c.textMuted }]}>
          {t('credentials.loginId')}
        </Text>
        <Text
          testID="credential-login-id"
          style={[theme.typography.display, { color: c.text, letterSpacing: 1 }]}
        >
          {props.childLoginId}
        </Text>
      </View>
      <View>
        <Text style={[theme.typography.caption, { color: c.textMuted }]}>
          {t('credentials.pin')}
        </Text>
        <Text
          testID="credential-pin"
          style={[theme.typography.display, { color: c.child, letterSpacing: 6 }]}
        >
          {props.pin}
        </Text>
      </View>
    </View>
  );
});
