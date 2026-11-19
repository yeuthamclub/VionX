import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme.ts';

/** Widest a screen's content gets, in dp. A phone is narrower, so nothing changes there. */
export const CONTENT_MAX_WIDTH = 720;

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
        // Tablets (the child's device) and landscape: one centred column, not full-width rows.
        contentContainerStyle={{
          padding: theme.spacing.xl,
          gap: theme.spacing.lg,
          width: '100%',
          maxWidth: CONTENT_MAX_WIDTH,
          alignSelf: 'center',
        }}
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
