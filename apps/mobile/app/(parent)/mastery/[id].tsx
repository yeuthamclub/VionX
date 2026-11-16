import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { parentApi } from '../../../src/api.ts';
import { t } from '../../../src/i18n/index.ts';
import { unwrap } from '../../../src/lib/api-error.ts';
import { useTheme } from '../../../src/theme.ts';
import { Button } from '../../../src/ui/Button.tsx';
import { StateBadge } from '../../../src/ui/practice/StateBadge.tsx';
import { Screen } from '../../../src/ui/Screen.tsx';
import { StateView } from '../../../src/ui/StateView.tsx';
import { useLoad } from '../../../src/ui/useLoad.ts';

/** Parent: mastery state of every skill of a child, by subject. */
export default function StudentMastery() {
  const theme = useTheme();
  const c = theme.colors;
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { state, reload } = useLoad(
    () =>
      unwrap(parentApi.GET('/api/v1/students/{id}/knowledge-map', { params: { path: { id } } })),
    [id],
  );
  return (
    <Screen
      title={t('mastery.title')}
      {...(name ? { subtitle: name } : {})}
      testID="screen-mastery"
    >
      <StateView
        state={state}
        reload={reload}
        isEmpty={(d) => d.subjects.length === 0}
        empty={
          <Text style={[theme.typography.body, { color: c.textMuted }]}>{t('mastery.empty')}</Text>
        }
      >
        {(map) => (
          <>
            {map.subjects.map((s) => (
              <View
                key={s.subject}
                testID={`mastery-${s.subject}`}
                style={{ gap: theme.spacing.sm }}
              >
                <Text style={[theme.typography.heading, { color: c.text }]}>{s.title}</Text>
                {s.nodes
                  .filter((n) => n.level === 'SKILL')
                  .map((n) => (
                    <View
                      key={n.id}
                      testID={`mastery-skill-${n.id}`}
                      style={{
                        padding: theme.spacing.md,
                        borderRadius: theme.radii.md,
                        borderWidth: 1,
                        borderColor: c.border,
                        backgroundColor: c.surface,
                        gap: theme.spacing.xs,
                      }}
                    >
                      <Text style={[theme.typography.body, { color: c.text }]}>{n.title}</Text>
                      <StateBadge state={n.state} />
                      {n.attemptCount > 0 && (
                        <Text style={[theme.typography.caption, { color: c.textMuted }]}>
                          {t('mastery.detail', {
                            score: Math.round(n.masteryScore),
                            attempts: n.attemptCount,
                            accuracy: Math.round((n.recentAccuracy ?? 0) * 100),
                          })}
                        </Text>
                      )}
                    </View>
                  ))}
              </View>
            ))}
          </>
        )}
      </StateView>
      <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
