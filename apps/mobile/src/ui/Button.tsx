import { ActivityIndicator, Pressable, Text } from 'react-native';
import { useTheme } from '../theme.ts';

export function Button(props: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
  color?: string;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const variant = props.variant ?? 'primary';
  const background =
    variant === 'primary'
      ? (props.color ?? c.primary)
      : variant === 'danger'
        ? c.dangerBg
        : c.surface;
  const foreground =
    variant === 'primary' ? c.onPrimary : variant === 'danger' ? c.danger : c.primary;
  const inactive = props.disabled || props.busy;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(inactive), busy: Boolean(props.busy) }}
      disabled={inactive}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: theme.touchTarget.default,
        borderRadius: theme.radii.md,
        paddingHorizontal: theme.spacing.lg,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: background,
        borderWidth: variant === 'secondary' ? 1 : 0,
        borderColor: c.border,
        opacity: inactive ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {props.busy ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <Text style={[theme.typography.bodyStrong, { color: foreground }]}>{props.label}</Text>
      )}
    </Pressable>
  );
}
