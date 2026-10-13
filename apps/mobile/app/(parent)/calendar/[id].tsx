import { addDays, DEFAULT_HOUSEHOLD_TIMEZONE, householdToday } from '@vionx/domain';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { parentApi } from '../../../src/api.ts';
import { t, type MessageKey } from '../../../src/i18n/index.ts';
import { unwrap } from '../../../src/lib/api-error.ts';
import { agendaByDay, dayLabel, localTimeOf, subjectName, weekOf } from '../../../src/lib/tasks.ts';
import { useTheme } from '../../../src/theme.ts';
import { Button } from '../../../src/ui/Button.tsx';
import { Screen } from '../../../src/ui/Screen.tsx';
import { StateView } from '../../../src/ui/StateView.tsx';
import { TaskCard } from '../../../src/ui/TaskCard.tsx';
import { useLoad } from '../../../src/ui/useLoad.ts';

/** Parent week calendar for one child: school periods, events and task days (Mon–Sun). */
export default function ParentWeekCalendar() {
  const theme = useTheme();
  const c = theme.colors;
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  // null = this week (the server's "today" decides it on first load).
  const [anchor, setAnchor] = useState<string | null>(null);
  const { state, reload } = useLoad(async () => {
    const base = anchor ?? householdToday(new Date(), DEFAULT_HOUSEHOLD_TIMEZONE);
    const { from, to } = weekOf(base);
    return unwrap(
      parentApi.GET('/api/v1/students/{id}/calendar', {
        params: { path: { id }, query: { from, to } },
      }),
    );
  }, [id, anchor]);

  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) reload();
      focused.current = true;
    }, [reload]),
  );

  const shift = (days: number) => {
    if (state.kind !== 'ready') return;
    setAnchor(addDays(state.data.from, days));
  };

  return (
    <Screen
      title={name ? t('calendar.title', { name }) : t('student.calendar')}
      testID="screen-calendar"
    >
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            testID="week-prev"
            label={t('calendar.prevWeek')}
            variant="secondary"
            onPress={() => shift(-7)}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            testID="week-this"
            label={t('calendar.thisWeek')}
            variant="secondary"
            onPress={() => setAnchor(null)}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            testID="week-next"
            label={t('calendar.nextWeek')}
            variant="secondary"
            onPress={() => shift(7)}
          />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            testID="add-task"
            label={t('calendar.addTask')}
            color={c.parent}
            onPress={() => router.push({ pathname: '/task-form', params: { studentId: id } })}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            testID="add-event"
            label={t('calendar.addEvent')}
            variant="secondary"
            onPress={() => router.push({ pathname: '/event-form', params: { studentId: id } })}
          />
        </View>
      </View>
      <Button
        testID="open-timetable"
        label={t('calendar.timetable')}
        variant="secondary"
        onPress={() => router.push({ pathname: '/timetable/[id]', params: { id } })}
      />
      <StateView state={state} reload={reload}>
        {(cal) => (
          <View style={{ gap: theme.spacing.lg }}>
            <Text style={[theme.typography.caption, { color: c.textMuted }]}>
              {t('calendar.week', { from: dayLabel(cal.from), to: dayLabel(cal.to) })}
            </Text>
            {agendaByDay(cal).map((day) => {
              const empty =
                day.timetable.length === 0 && day.events.length === 0 && day.tasks.length === 0;
              return (
                <View key={day.date} testID={`day-${day.date}`} style={{ gap: theme.spacing.sm }}>
                  <Text
                    style={[
                      theme.typography.heading,
                      { color: day.date === cal.today ? c.parent : c.text },
                    ]}
                  >
                    {dayLabel(day.date)}
                    {day.date === cal.today ? ` · ${t('calendar.today')}` : ''}
                  </Text>
                  {empty && (
                    <Text style={[theme.typography.caption, { color: c.textMuted }]}>
                      {t('calendar.emptyDay')}
                    </Text>
                  )}
                  {day.timetable.length > 0 && (
                    <Text style={[theme.typography.caption, { color: c.textMuted }]}>
                      {day.timetable
                        .map(
                          (s) =>
                            `${s.startTime} ${subjectName(s.subjectCode)}${s.room ? ` (${s.room})` : ''}`,
                        )
                        .join(' · ')}
                    </Text>
                  )}
                  {day.events.map((e) => (
                    <Text
                      key={e.id}
                      testID={`event-${e.id}`}
                      style={[theme.typography.body, { color: c.text }]}
                    >
                      {e.allDay ? t('calendar.allDay') : localTimeOf(e.startsAt, cal.timezone)} ·{' '}
                      {e.title} ({t(`eventType.${e.type}` as MessageKey)})
                    </Text>
                  ))}
                  {day.tasks.map((o) => (
                    <TaskCard
                      key={o.id}
                      occurrence={o}
                      today={cal.today}
                      mode="parent"
                      onPress={() =>
                        router.push({ pathname: '/task-form', params: { taskId: o.taskId } })
                      }
                    />
                  ))}
                </View>
              );
            })}
          </View>
        )}
      </StateView>
    </Screen>
  );
}
