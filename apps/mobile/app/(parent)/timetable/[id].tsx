import type { TimetableEntry } from '@vionx/contracts/client';
import { subjectsForGrade } from '@vionx/domain';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { parentApi } from '../../../src/api.ts';
import { t } from '../../../src/i18n/index.ts';
import { describeError, unwrap } from '../../../src/lib/api-error.ts';
import { subjectName, timeWindowError, weekdayLabel } from '../../../src/lib/tasks.ts';
import { useTheme } from '../../../src/theme.ts';
import { Button } from '../../../src/ui/Button.tsx';
import { Chip, ChipRow } from '../../../src/ui/Chip.tsx';
import { Notice } from '../../../src/ui/Notice.tsx';
import { Screen } from '../../../src/ui/Screen.tsx';
import { StateView } from '../../../src/ui/StateView.tsx';
import { TextField } from '../../../src/ui/TextField.tsx';
import { useLoad } from '../../../src/ui/useLoad.ts';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/** Timetable editor: the child's weekly school periods, grouped by day; add and delete. */
export default function TimetableEditor() {
  const theme = useTheme();
  const c = theme.colors;
  const { id } = useLocalSearchParams<{ id: string }>();
  const path = { params: { path: { id } } };
  const { state, reload } = useLoad(async () => {
    const [student, timetable] = await Promise.all([
      unwrap(parentApi.GET('/api/v1/students/{id}', path)),
      unwrap(parentApi.GET('/api/v1/students/{id}/timetable', path)),
    ]);
    return { grade: student.grade, entries: timetable.entries };
  }, [id]);

  const [weekday, setWeekday] = useState(1);
  const [start, setStart] = useState('07:00');
  const [end, setEnd] = useState('07:45');
  const [subject, setSubject] = useState('TOAN');
  const [room, setRoom] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timeError = timeWindowError(start, end) || start === '' ? 'timetable.timeInvalid' : null;

  const add = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await unwrap(
        parentApi.POST('/api/v1/students/{id}/timetable', {
          ...path,
          body: {
            weekday,
            startTime: start,
            endTime: end,
            subjectCode: subject,
            room: room.trim() || null,
          },
        }),
      );
      reload();
    } catch (e) {
      setMessage(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (entry: TimetableEntry) =>
    Alert.alert(t('timetable.delete'), t('timetable.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('timetable.delete'),
        style: 'destructive',
        onPress: () =>
          void unwrap(
            parentApi.DELETE('/api/v1/timetable/{entryId}', {
              params: { path: { entryId: entry.id } },
            }),
          ).then(
            () => reload(),
            (e: unknown) => setMessage(describeError(e)),
          ),
      },
    ]);

  return (
    <Screen title={t('timetable.title')} testID="screen-timetable">
      <StateView state={state} reload={reload}>
        {(data) => (
          <View style={{ gap: theme.spacing.lg }}>
            {data.entries.length === 0 && (
              <Text testID="timetable-empty" style={{ color: c.textMuted }}>
                {t('timetable.empty')}
              </Text>
            )}
            {WEEKDAYS.map((d) => {
              const entries = data.entries.filter((e) => e.weekday === d);
              if (entries.length === 0) return null;
              return (
                <View key={d} style={{ gap: theme.spacing.xs }}>
                  <Text style={[theme.typography.bodyStrong, { color: c.text }]}>
                    {weekdayLabel(d)}
                  </Text>
                  {entries.map((e) => (
                    <Pressable
                      key={e.id}
                      testID={`timetable-entry-${e.id}`}
                      accessibilityRole="button"
                      accessibilityHint={t('timetable.delete')}
                      onLongPress={() => remove(e)}
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        padding: theme.spacing.sm,
                        backgroundColor: c.surface,
                        borderRadius: theme.radii.md,
                      }}
                    >
                      <Text style={{ color: c.text }}>
                        {e.startTime}–{e.endTime} {subjectName(e.subjectCode)}
                        {e.room ? ` (${e.room})` : ''}
                      </Text>
                      <Text
                        testID={`timetable-delete-${e.id}`}
                        onPress={() => remove(e)}
                        style={{ color: c.danger }}
                      >
                        {t('timetable.delete')}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              );
            })}

            <View
              style={{
                gap: theme.spacing.md,
                padding: theme.spacing.lg,
                backgroundColor: c.surfaceMuted,
                borderRadius: theme.radii.lg,
              }}
            >
              <Text style={[theme.typography.heading, { color: c.text }]}>
                {t('timetable.add')}
              </Text>
              <ChipRow label={t('timetable.weekday')}>
                {WEEKDAYS.map((d) => (
                  <Chip
                    key={d}
                    testID={`tt-weekday-${d}`}
                    label={weekdayLabel(d)}
                    selected={weekday === d}
                    onPress={() => setWeekday(d)}
                  />
                ))}
              </ChipRow>
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <TextField
                    testID="tt-start"
                    label={t('timetable.start')}
                    value={start}
                    onChangeText={setStart}
                    maxLength={5}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <TextField
                    testID="tt-end"
                    label={t('timetable.end')}
                    value={end}
                    onChangeText={setEnd}
                    maxLength={5}
                  />
                </View>
              </View>
              {timeError && <Notice message={t(timeError)} />}
              <ChipRow label={t('timetable.subject')}>
                {subjectsForGrade(data.grade).map((s) => (
                  <Chip
                    key={s.code}
                    testID={`tt-subject-${s.code}`}
                    label={subjectName(s.code)}
                    selected={subject === s.code}
                    onPress={() => setSubject(s.code)}
                  />
                ))}
              </ChipRow>
              <TextField
                testID="tt-room"
                label={t('timetable.room')}
                value={room}
                onChangeText={setRoom}
                maxLength={40}
              />
              <Button
                testID="tt-add"
                label={t('timetable.add')}
                color={c.parent}
                busy={busy}
                disabled={Boolean(timeError)}
                onPress={() => void add()}
              />
            </View>
          </View>
        )}
      </StateView>
      {message && <Notice message={message} />}
    </Screen>
  );
}
