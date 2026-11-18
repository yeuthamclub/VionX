import type { DashboardResponse, SchoolAssessment } from '@vionx/contracts/client';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { parentApi } from '../../../src/api.ts';
import { t, type MessageKey } from '../../../src/i18n/index.ts';
import { unwrap } from '../../../src/lib/api-error.ts';
import {
  examText,
  percentText,
  scoreText,
  subjectName,
  trendText,
} from '../../../src/lib/dashboard.ts';
import { useTheme } from '../../../src/theme.ts';
import { Button } from '../../../src/ui/Button.tsx';
import { Chip, ChipRow } from '../../../src/ui/Chip.tsx';
import { Figure, SufficiencyBadge, TrendChart } from '../../../src/ui/dashboard.tsx';
import { StateBadge } from '../../../src/ui/practice/StateBadge.tsx';
import { Screen } from '../../../src/ui/Screen.tsx';
import { StateView } from '../../../src/ui/StateView.tsx';
import { useLoad } from '../../../src/ui/useLoad.ts';

const TABS = ['overview', 'learning', 'school', 'tasks'] as const;
type Tab = (typeof TABS)[number];
const RANGES = ['7d', '30d', '90d'] as const;

/** Parent: one child in four tabs: Overview, Learning, School, Tasks & rewards. */
export default function StudentDashboard() {
  const theme = useTheme();
  const c = theme.colors;
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const [range, setRange] = useState<(typeof RANGES)[number]>('7d');
  const { state, reload } = useLoad(async () => {
    const path = { id };
    const [dashboard, grades] = await Promise.all([
      unwrap(
        parentApi.GET('/api/v1/students/{id}/dashboard', { params: { path, query: { range } } }),
      ),
      unwrap(
        parentApi.GET('/api/v1/students/{id}/school-assessments', {
          params: { path, query: { limit: 30 } },
        }),
      ),
    ]);
    return { dashboard, grades: grades.assessments };
  }, [id, range]);

  // Back from the grade form: read again.
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) reload();
      focused.current = true;
    }, [reload]),
  );

  const section = (title: string) => (
    <Text style={[theme.typography.heading, { color: c.text }]}>{title}</Text>
  );
  const muted = (text: string, testID?: string) => (
    <Text testID={testID} style={[theme.typography.body, { color: c.textMuted }]}>
      {text}
    </Text>
  );
  const row = { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md } as const;
  const box = {
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  } as const;

  const overview = (d: DashboardResponse) => (
    <>
      {section(t('dashboard.today'))}
      <View style={row}>
        <Figure
          testID="dash-today-items"
          label={t('dashboard.todayItems')}
          value={`${d.today.itemsDone}/${d.today.itemsTotal}`}
        />
        <Figure
          label={t('dashboard.todayMinutes')}
          value={`${d.today.doneMinutes}/${d.today.budgetMinutes}`}
        />
        <Figure
          testID="dash-streak"
          label={t('dashboard.streak')}
          value={t('dashboard.days', { n: d.streak.days })}
        />
      </View>
      <SufficiencyBadge level={d.streak.sufficiency} testID="dash-streak-sufficiency" />
      {section(t('dashboard.sideBySide'))}
      {muted(t('dashboard.sideBySideNote'))}
      {d.sideBySide.length === 0 && muted(t('grades.empty'), 'dash-side-empty')}
      {d.sideBySide.map((s) => (
        <View key={s.subjectCode} testID={`side-${s.subjectCode}`} style={box}>
          <Text style={[theme.typography.bodyStrong, { color: c.text }]}>
            {subjectName(s.subjectCode)}
          </Text>
          <View style={row}>
            <View style={{ flex: 1, gap: theme.spacing.xs }}>
              <Figure
                label={t('dashboard.schoolAverage', { n: s.school.count })}
                value={s.school.averagePercent === null ? '–' : `${s.school.averagePercent}%`}
              />
              <SufficiencyBadge level={s.school.sufficiency} />
            </View>
            <View style={{ flex: 1, gap: theme.spacing.xs }}>
              <Figure
                label={
                  s.mastery
                    ? t('dashboard.appMastery', { n: s.mastery.practised, total: s.mastery.skills })
                    : t('dashboard.noLibrary')
                }
                value={
                  s.mastery?.meanScore === null || !s.mastery
                    ? '–'
                    : `${Math.round(s.mastery.meanScore)}/100`
                }
              />
              {s.mastery && <SufficiencyBadge level={s.mastery.sufficiency} />}
            </View>
          </View>
        </View>
      ))}
      {section(t('dashboard.exams'))}
      {d.upcomingExams.length === 0 && muted(t('dashboard.noExams'))}
      {d.upcomingExams.map((e) => (
        <Text key={e.eventId} style={[theme.typography.body, { color: c.text }]}>
          {examText(e)}
        </Text>
      ))}
    </>
  );

  const learning = (d: DashboardResponse) => (
    <>
      <View style={row}>
        <Figure label={t('dashboard.sessions')} value={String(d.learning.sessions)} />
        <Figure label={t('dashboard.minutes')} value={String(d.learning.minutes)} />
        <Figure
          testID="dash-accuracy"
          label={t('dashboard.accuracy', { n: d.learning.answers })}
          value={percentText(d.learning.accuracy)}
        />
      </View>
      <SufficiencyBadge level={d.learning.sufficiency} />
      {(['improving', 'atRisk'] as const).map((kind) => (
        <View key={kind} testID={`dash-${kind}`} style={{ gap: theme.spacing.sm }}>
          {section(t(`dashboard.${kind}` as MessageKey))}
          {d.learning[kind].length === 0 && muted(t('dashboard.noSignal'))}
          {d.learning[kind].map((s) => (
            <View key={s.skillId} style={box}>
              <Text style={[theme.typography.body, { color: c.text }]}>{s.title}</Text>
              <Text style={[theme.typography.caption, { color: c.textMuted }]}>
                {t(`dashboard.reason.${s.reason}` as MessageKey)}
              </Text>
              <StateBadge state={s.state} />
              <SufficiencyBadge level={s.sufficiency} />
            </View>
          ))}
        </View>
      ))}
      {section(t('dashboard.bySubject'))}
      {d.learning.subjects.map((s) => (
        <View key={s.subject} testID={`dash-subject-${s.subject}`} style={box}>
          <Text style={[theme.typography.bodyStrong, { color: c.text }]}>{s.title}</Text>
          <Text style={[theme.typography.body, { color: c.text }]}>
            {t('dashboard.subjectLine', {
              practised: s.practised,
              skills: s.skills,
              proficient: s.proficient,
              score: s.meanScore === null ? '–' : Math.round(s.meanScore),
            })}
          </Text>
          <SufficiencyBadge level={s.sufficiency} />
        </View>
      ))}
      <Button
        testID="dash-open-mastery"
        label={t('student.mastery')}
        variant="secondary"
        onPress={() =>
          router.push({ pathname: '/mastery/[id]', params: { id, ...(name ? { name } : {}) } })
        }
      />
    </>
  );

  const school = (d: DashboardResponse, grades: SchoolAssessment[]) => (
    <>
      <Button
        testID="add-grade"
        label={t('grades.add')}
        color={c.parent}
        onPress={() =>
          router.push({
            pathname: '/grade-form',
            params: { studentId: id, grade: String(d.grade) },
          })
        }
      />
      {muted(t('grades.year', { year: d.school.schoolYear }))}
      {d.school.subjects.length === 0 && muted(t('grades.empty'), 'grades-empty')}
      {d.school.subjects.map((s) => (
        <View key={s.subjectCode} testID={`grades-${s.subjectCode}`} style={box}>
          <Text style={[theme.typography.bodyStrong, { color: c.text }]}>
            {subjectName(s.subjectCode)}
          </Text>
          <Text style={[theme.typography.body, { color: c.text }]}>
            {t('grades.subjectLine', {
              n: s.count,
              avg: s.averagePercent ?? '–',
              trend: trendText(s),
            })}
          </Text>
          <SufficiencyBadge level={s.sufficiency} />
          <TrendChart subject={s} />
        </View>
      ))}
      {grades.length > 0 && section(t('grades.table'))}
      {grades.map((g) => (
        <View
          key={g.id}
          testID={`grade-${g.id}`}
          style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}
        >
          <Text style={[theme.typography.caption, { color: c.textMuted, width: 84 }]}>
            {g.assessedOn}
          </Text>
          <Text style={[theme.typography.body, { color: c.text, flex: 1 }]}>
            {`${subjectName(g.subjectCode)} · ${t(`grades.type.${g.type}` as MessageKey)}`}
          </Text>
          <Text style={[theme.typography.bodyStrong, { color: c.text }]}>{scoreText(g)}</Text>
        </View>
      ))}
    </>
  );

  const tasks = (d: DashboardResponse) => (
    <>
      <View style={row}>
        <Figure
          testID="dash-tasks"
          label={t('dashboard.tasksDone')}
          value={`${d.tasks.done}/${d.tasks.total}`}
        />
        <Figure
          label={t('dashboard.requiredDone')}
          value={`${d.tasks.requiredDone}/${d.tasks.requiredTotal}`}
        />
        <Figure label={t('dashboard.completion')} value={percentText(d.tasks.completion)} />
      </View>
      <SufficiencyBadge level={d.tasks.sufficiency} />
      {section(t('dashboard.rewards'))}
      <View style={row}>
        <Figure
          testID="dash-coins"
          label={t('dashboard.coinBalance')}
          value={String(d.rewards.coinBalance)}
        />
        <Figure
          label={t('dashboard.coinsToday', { cap: d.rewards.capCoinsToday })}
          value={String(d.rewards.coinsToday)}
        />
        <Figure label={t('dashboard.coinsWeek')} value={String(d.rewards.coinsWeek)} />
      </View>
      <View style={row}>
        <Figure label={t('dashboard.xpRange')} value={String(d.rewards.xpInRange)} />
        <Figure label={t('dashboard.level')} value={String(d.rewards.level)} />
      </View>
      {section(t('dashboard.byDay'))}
      {d.days
        .filter((day) => day.tasksTotal > 0 || day.sessions > 0 || day.xpEarned > 0)
        .reverse()
        .slice(0, 14)
        .map((day) => (
          <Text key={day.day} style={[theme.typography.body, { color: c.text }]}>
            {t('dashboard.dayLine', {
              day: day.day,
              done: day.tasksDone,
              total: day.tasksTotal,
              sessions: day.sessions,
              xp: day.xpEarned,
            })}
          </Text>
        ))}
    </>
  );

  return (
    <Screen
      title={t('dashboard.title')}
      {...(name ? { subtitle: name } : {})}
      testID="screen-dashboard"
    >
      <ChipRow>
        {TABS.map((x) => (
          <Chip
            key={x}
            testID={`dash-tab-${x}`}
            label={t(`dashboard.tab.${x}` as MessageKey)}
            selected={tab === x}
            color={c.parent}
            onPress={() => setTab(x)}
          />
        ))}
      </ChipRow>
      {tab !== 'school' && (
        <ChipRow label={t('dashboard.range')}>
          {RANGES.map((r) => (
            <Chip
              key={r}
              testID={`dash-range-${r}`}
              label={t(`dashboard.range.${r}` as MessageKey)}
              selected={range === r}
              onPress={() => setRange(r)}
            />
          ))}
        </ChipRow>
      )}
      <StateView state={state} reload={reload}>
        {({ dashboard: d, grades }) => (
          <View testID={`dash-panel-${tab}`} style={{ gap: theme.spacing.md }}>
            {tab === 'overview' && overview(d)}
            {tab === 'learning' && learning(d)}
            {tab === 'school' && school(d, grades)}
            {tab === 'tasks' && tasks(d)}
          </View>
        )}
      </StateView>
    </Screen>
  );
}
