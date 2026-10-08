import { Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../theme.ts';

export function TextField(props: TextInputProps & { label: string; error?: string | null }) {
  const theme = useTheme();
  const c = theme.colors;
  const { label, error, style, ...input } = props;
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text style={[theme.typography.caption, { color: c.textMuted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.textMuted}
        style={[
          theme.typography.body,
          {
            minHeight: theme.touchTarget.default,
            borderWidth: 1,
            borderColor: error ? c.danger : c.border,
            borderRadius: theme.radii.md,
            paddingHorizontal: theme.spacing.md,
            color: c.text,
            backgroundColor: c.surface,
          },
          style,
        ]}
        {...input}
      />
      {error ? <Text style={[theme.typography.caption, { color: c.danger }]}>{error}</Text> : null}
    </View>
  );
}
