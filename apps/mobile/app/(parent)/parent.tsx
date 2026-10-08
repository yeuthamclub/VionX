import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t } from '../../src/i18n/index.ts';
import { useTheme } from '../../src/theme.ts';

/** Placeholder: parent mode screens arrive from M01. */
export default function Placeholder() {
  const theme = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, padding: theme.spacing.xl, gap: theme.spacing.lg }}>
      <Text style={[theme.typography.heading, { color: theme.colors.text }]}>
        {t('parent.placeholder')}
      </Text>
      <Pressable accessibilityRole="button" onPress={() => router.back()}>
        <Text style={{ color: theme.colors.primary }}>{t('common.back')}</Text>
      </Pressable>
    </SafeAreaView>
  );
}
