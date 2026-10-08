import { Pressable, Text, View } from 'react-native';
import { t } from '../i18n/index.ts';
import { PIN_PAD_ROWS, pressPinKey, type PinPadKey } from '../lib/pin-pad.ts';
import { useTheme } from '../theme.ts';

/** Large-key PIN pad for children (4-8 digits); the PIN is shown as dots. */
export function PinKeypad(props: {
  value: string;
  onChange: (pin: string) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const label = (key: PinPadKey) => (key === 'back' ? '⌫' : key === 'clear' ? 'C' : key);
  return (
    <View style={{ gap: theme.spacing.md, alignItems: 'center' }}>
      <Text style={[theme.typography.caption, { color: c.textMuted }]}>{t('childLogin.pin')}</Text>
      <View
        testID="pin-dots"
        accessibilityLabel={`${props.value.length}`}
        style={{ flexDirection: 'row', gap: 12, minHeight: 20 }}
      >
        {Array.from({ length: Math.max(4, props.value.length) }, (_, i) => (
          <View
            key={i}
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: i < props.value.length ? c.child : c.surfaceMuted,
              borderWidth: 1,
              borderColor: c.border,
            }}
          />
        ))}
      </View>
      {PIN_PAD_ROWS.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          {row.map((key) => (
            <Pressable
              key={key}
              testID={`pin-key-${key}`}
              accessibilityRole="button"
              accessibilityLabel={key}
              disabled={props.disabled}
              onPress={() => props.onChange(pressPinKey(props.value, key))}
              style={({ pressed }) => ({
                width: theme.touchTarget.child * 1.4,
                height: theme.touchTarget.child * 1.2,
                borderRadius: theme.radii.lg,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? c.surfaceMuted : c.surface,
                borderWidth: 1,
                borderColor: c.border,
              })}
            >
              <Text style={[theme.typography.title, { color: c.text }]}>{label(key)}</Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}
