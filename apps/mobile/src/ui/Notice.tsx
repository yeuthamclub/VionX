import { Text } from 'react-native';
import { useTheme } from '../theme.ts';

/** Inline error / info message. */
export function Notice(props: {
  message: string | null;
  tone?: 'error' | 'info';
  testID?: string;
}) {
  const theme = useTheme();
  if (!props.message) return null;
  const error = (props.tone ?? 'error') === 'error';
  return (
    <Text
      testID={props.testID}
      accessibilityLiveRegion="polite"
      style={[
        theme.typography.body,
        {
          color: error ? theme.colors.danger : theme.colors.text,
          backgroundColor: error ? theme.colors.dangerBg : theme.colors.surfaceMuted,
          padding: theme.spacing.md,
          borderRadius: theme.radii.md,
        },
      ]}
    >
      {props.message}
    </Text>
  );
}
