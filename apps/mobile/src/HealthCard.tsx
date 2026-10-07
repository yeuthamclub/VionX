import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { t, type MessageKey } from './i18n/index.ts';
import { useTheme } from './theme.ts';
import { useHealth } from './useHealth.ts';

const CHECKS = ['db', 'storage', 'queue', 'ai'] as const;

/** Shows the status returned by GET /api/v1/health (loading / ok / degraded / offline). */
export function HealthCard() {
  const theme = useTheme();
  const { state, refresh } = useHealth();
  const c = theme.colors;

  return (
    <View
      testID="health-card"
      style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
    >
      <Text style={[theme.typography.bodyStrong, { color: c.text }]}>{t('health.title')}</Text>

      {state.kind === 'loading' && (
        <View style={styles.row}>
          <ActivityIndicator color={c.primary} />
          <Text style={{ color: c.textMuted }}>{t('health.checking')}</Text>
        </View>
      )}

      {state.kind === 'offline' && (
        <>
          <Text testID="health-status" style={{ color: c.danger }}>
            {t('health.offline')}
          </Text>
          <Text style={[theme.typography.caption, { color: c.textMuted }]}>{state.message}</Text>
        </>
      )}

      {state.kind === 'ready' && (
        <>
          <Text
            testID="health-status"
            style={{ color: state.health.status === 'ok' ? c.success : c.danger }}
          >
            {state.health.status === 'ok' ? t('health.ok') : t('health.degraded')}
          </Text>
          {CHECKS.map((name) => {
            const check = state.health.checks[name];
            const color = check.ok ? c.success : check.critical ? c.danger : c.warning;
            return (
              <View key={name} style={styles.row}>
                <View style={[styles.dot, { backgroundColor: color }]} />
                <Text style={{ color: c.text }}>{t(`health.check.${name}` as MessageKey)}</Text>
              </View>
            );
          })}
        </>
      )}

      {state.kind !== 'loading' && (
        <Pressable accessibilityRole="button" onPress={() => void refresh()}>
          <Text style={{ color: c.primary }}>{t('health.retry')}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
