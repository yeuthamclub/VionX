import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HealthCard } from '../../src/HealthCard.tsx';
import { t } from '../../src/i18n/index.ts';
import { useTheme } from '../../src/theme.ts';

/** First-launch screen: "Phụ huynh / Con" plus the API health status. */
export default function Welcome() {
  const theme = useTheme();
  const c = theme.colors;

  const RoleButton = (props: {
    label: string;
    hint: string;
    color: string;
    to: string;
    id: string;
  }) => (
    <Pressable
      testID={props.id}
      accessibilityRole="button"
      onPress={() => router.push(props.to as never)}
      style={({ pressed }) => [
        styles.role,
        {
          backgroundColor: props.color,
          opacity: pressed ? 0.85 : 1,
          minHeight: theme.touchTarget.child * 2,
        },
      ]}
    >
      <Text style={[theme.typography.title, { color: c.onPrimary }]}>{props.label}</Text>
      <Text style={[theme.typography.caption, { color: c.onPrimary }]}>{props.hint}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text style={[theme.typography.display, { color: c.text }]}>{t('welcome.title')}</Text>
          <Text style={[theme.typography.body, { color: c.textMuted }]}>
            {t('welcome.subtitle')}
          </Text>
        </View>
        <RoleButton
          id="role-parent"
          label={t('welcome.parent')}
          hint={t('welcome.parentHint')}
          color={c.parent}
          to="/sign-in"
        />
        <RoleButton
          id="role-child"
          label={t('welcome.child')}
          hint={t('welcome.childHint')}
          color={c.child}
          to="/child"
        />
        <HealthCard />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  role: { borderRadius: 24, padding: 24, justifyContent: 'center', gap: 4 },
});
