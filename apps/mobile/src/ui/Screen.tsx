import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme.ts';

export function Screen(props: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      testID={props.testID}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }}
      >
        {(props.title || props.subtitle) && (
          <View style={{ gap: theme.spacing.xs }}>
            {props.title && (
              <Text style={[theme.typography.title, { color: theme.colors.text }]}>
                {props.title}
              </Text>
            )}
            {props.subtitle && (
              <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>
                {props.subtitle}
              </Text>
            )}
          </View>
        )}
        {props.children}
      </ScrollView>
    </SafeAreaView>
  );
}
