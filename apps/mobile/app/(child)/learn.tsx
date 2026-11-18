import type { KnowledgeNode } from '@vionx/contracts/client';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { childApi } from '../../src/api.ts';
import { t } from '../../src/i18n/index.ts';
import { AppError, unwrap } from '../../src/lib/api-error.ts';
import { topicsOf } from '../../src/lib/practice.ts';
import { childToken } from '../../src/state/device.ts';
import { useTheme } from '../../src/theme.ts';
import { Button } from '../../src/ui/Button.tsx';
import { ProgressBar } from '../../src/ui/CapBar.tsx';
import { Chip, ChipRow } from '../../src/ui/Chip.tsx';
import { StateBadge } from '../../src/ui/practice/StateBadge.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { StateView } from '../../src/ui/StateView.tsx';
import { useLoad } from '../../src/ui/useLoad.ts';

/** Child: Learn — knowledge map of the child's grade (subject → topics → skills) and what is next. */
export default function Learn() {
  const theme = useTheme();
  const c = theme.colors;
  const [subject, setSubject] = useState<string | null>(null);
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  const { state, reload } = useLoad(async () => {
    try {
      const session = await unwrap(childApi.GET('/api/v1/auth/child/session'));
      const id = session.student.id;
      const [map, path] = await Promise.all([
        unwrap(childApi.GET('/api/v1/students/{id}/knowledge-map', { params: { path: { id } } })),
        unwrap(childApi.GET('/api/v1/students/{id}/learning-path', { params: { path: { id } } })),
      ]);
      return { map, path };
    } catch (e) {
      if (e instanceof AppError && e.status === 401) {
        await childToken.clear();
        router.replace('/child');
      }
      throw e;
    }
  });
  const start = (params: { nodeId?: string; mode?: string; subject?: string }) =>
    router.push({ pathname: '/practice', params });

  const skillRow = (skill: KnowledgeNode) => (
    <Pressable
      key={skill.id}
      testID={`skill-${skill.id}`}
      accessibilityRole="button"
      onPress={() => start({ nodeId: skill.id })}
      style={{
        minHeight: theme.touchTarget.child,
        paddingVertical: theme.spacing.sm,
        borderTopWidth: 1,
        borderColor: c.border,
        gap: theme.spacing.xs,
      }}
    >
      <Text style={[theme.typography.body, { color: c.text }]}>{skill.title}</Text>
      <StateBadge state={skill.state} />
    </Pressable>
  );

  return (
    <Screen title={t('learn.title')} testID="screen-learn">
      <StateView
        state={state}
        reload={reload}
        isEmpty={(d) => d.map.subjects.length === 0}
        empty={
          <Text style={[theme.typography.body, { color: c.textMuted }]}>{t('learn.empty')}</Text>
        }
      >
        {({ map, path }) => {
          const current = map.subjects.find((s) => s.subject === subject) ?? map.subjects[0]!;
          const due = path.steps.filter(
            (s) => s.kind === 'REVIEW_DUE' && s.subject === current.subject,
          );
          const next = path.steps.find(
            (s) => s.kind !== 'REVIEW_DUE' && s.subject === current.subject,
          );
          return (
            <>
              <ChipRow>
                {map.subjects.map((s) => (
                  <Chip
                    key={s.subject}
                    testID={`subject-${s.subject}`}
                    label={s.title}
                    selected={s.subject === current.subject}
                    color={c.child}
                    onPress={() => setSubject(s.subject)}
                  />
                ))}
              </ChipRow>
              {due.length > 0 && (
                <Button
                  testID="start-review"
                  label={t('learn.review', { n: due.length })}
                  color={c.reward}
                  onPress={() => start({ mode: 'REVIEW', subject: current.subject })}
                />
              )}
              {next && (
                <Button
                  testID="start-next"
                  label={t('learn.next', { title: next.skillTitle })}
                  color={c.child}
                  onPress={() => start({ nodeId: next.skillId })}
                />
              )}
              {topicsOf(current.nodes).map((topic) => (
                <View
                  key={topic.id}
                  testID={`topic-${topic.id}`}
                  style={{
                    borderRadius: theme.radii.md,
                    borderWidth: 1,
                    borderColor: c.border,
                    backgroundColor: c.surface,
                    padding: theme.spacing.md,
                    gap: theme.spacing.sm,
                  }}
                >
                  <Pressable
                    testID={`topic-toggle-${topic.id}`}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: openTopic === topic.id }}
                    onPress={() => setOpenTopic(openTopic === topic.id ? null : topic.id)}
                    style={{ minHeight: theme.touchTarget.child, gap: theme.spacing.xs }}
                  >
                    <Text style={[theme.typography.bodyStrong, { color: c.text }]}>
                      {topic.title}
                    </Text>
                    <StateBadge state={topic.state} />
                    <ProgressBar
                      fraction={topic.masteryScore / 100}
                      caption={t('learn.skills', { n: topic.skillCount })}
                      color={c.child}
                    />
                  </Pressable>
                  <Button
                    testID={`start-topic-${topic.id}`}
                    label={topic.attemptCount === 0 ? t('learn.diagnose') : t('learn.practise')}
                    color={c.child}
                    onPress={() => start({ nodeId: topic.id })}
                  />
                  {openTopic === topic.id &&
                    current.nodes
                      .filter((n) => n.parentId === topic.id && n.level === 'SKILL')
                      .map(skillRow)}
                </View>
              ))}
            </>
          );
        }}
      </StateView>
      <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
