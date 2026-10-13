import { Text, View } from 'react-native';
import { useTheme } from '../theme.ts';

/** A labelled progress bar (today's cap bar, level progress). */
export function ProgressBar(props: {
  fraction: number;
  caption: string;
  color?: string;
  testID?: string;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const pct = Math.round(Math.max(0, Math.min(1, props.fraction)) * 100);
  return (
    <View style={{ gap: theme.spacing.xs }} testID={props.testID}>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: pct }}
        style={{
          height: 14,
          borderRadius: theme.radii.lg,
          backgroundColor: c.surfaceMuted,
          overflow: 'hidden',
        }}
      >
        <View
          testID={props.testID ? `${props.testID}-fill` : undefined}
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: theme.radii.lg,
            backgroundColor: props.color ?? c.reward,
          }}
        />
      </View>
      <Text style={[theme.typography.caption, { color: c.textMuted }]}>{props.caption}</Text>
    </View>
  );
}
