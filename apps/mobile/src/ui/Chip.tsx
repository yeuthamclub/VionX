import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme.ts';

/** A selectable pill (form choices: type, repeat, weekday, verification mode, subject). */
export function Chip(props: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
  color?: string;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const accent = props.color ?? c.primary;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: 40,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radii.lg,
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: props.selected ? accent : c.border,
        backgroundColor: props.selected ? accent : c.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text style={[theme.typography.caption, { color: props.selected ? c.onPrimary : c.text }]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

/** Wrapping row of chips with a caption. */
export function ChipRow(props: { label?: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      {props.label && (
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
          {props.label}
        </Text>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {props.children}
      </View>
    </View>
  );
}
