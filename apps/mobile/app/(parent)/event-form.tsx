import type { CalendarEventType } from '@vionx/contracts/client';
import {
  CALENDAR_EVENT_TYPES,
  DEFAULT_HOUSEHOLD_TIMEZONE,
  householdToday,
  isValidDay,
  isValidTime,
  timeToMinutes,
  zonedDayStart,
} from '@vionx/domain';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { parentApi } from '../../src/api.ts';
import { t, type MessageKey } from '../../src/i18n/index.ts';
import { describeError, unwrap } from '../../src/lib/api-error.ts';
import { useTheme } from '../../src/theme.ts';
import { Button } from '../../src/ui/Button.tsx';
import { Chip, ChipRow } from '../../src/ui/Chip.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { TextField } from '../../src/ui/TextField.tsx';

/** Household-local day + HH:MM → ISO instant. */
function instant(day: string, time: string, timeZone: string): string {
  return new Date(
    zonedDayStart(day, timeZone).getTime() + timeToMinutes(time) * 60_000,
  ).toISOString();
}

/** Add a calendar event (Master Spec §13.1 types) for one child. */
export default function EventForm() {
  const theme = useTheme();
  const { studentId } = useLocalSearchParams<{ studentId: string }>();
  // Households are Asia/Ho_Chi_Minh in v1 (household-new has no timezone picker).
  const tz = DEFAULT_HOUSEHOLD_TIMEZONE;
  const [type, setType] = useState<CalendarEventType>('EXAM');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(householdToday(new Date(), tz));
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('19:00');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const valid =
    title.trim() !== '' &&
    isValidDay(date) &&
    isValidTime(start) &&
    isValidTime(end) &&
    timeToMinutes(start) < timeToMinutes(end);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await unwrap(
        parentApi.POST('/api/v1/students/{id}/events', {
          params: { path: { id: studentId } },
          body: {
            type,
            title: title.trim(),
            note: note.trim() || null,
            startsAt: instant(date, start, tz),
            endsAt: instant(date, end, tz),
          },
        }),
      );
      router.back();
    } catch (e) {
      setMessage(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('eventForm.title')} testID="screen-event-form">
      <ChipRow label={t('eventForm.type')}>
        {CALENDAR_EVENT_TYPES.map((ty) => (
          <Chip
            key={ty}
            testID={`event-type-${ty}`}
            label={t(`eventType.${ty}` as MessageKey)}
            selected={type === ty}
            onPress={() => setType(ty)}
          />
        ))}
      </ChipRow>
      <TextField
        testID="event-title"
        label={t('eventForm.name')}
        value={title}
        onChangeText={setTitle}
        maxLength={80}
      />
      <TextField
        testID="event-date"
        label={t('eventForm.date')}
        value={date}
        onChangeText={setDate}
        maxLength={10}
      />
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <TextField
            testID="event-start"
            label={t('eventForm.start')}
            value={start}
            onChangeText={setStart}
            maxLength={5}
          />
        </View>
        <View style={{ flex: 1 }}>
          <TextField
            testID="event-end"
            label={t('eventForm.end')}
            value={end}
            onChangeText={setEnd}
            maxLength={5}
          />
        </View>
      </View>
      {!valid && title.trim() !== '' && <Notice message={t('eventForm.timeInvalid')} />}
      <TextField
        testID="event-note"
        label={t('eventForm.note')}
        value={note}
        onChangeText={setNote}
        maxLength={500}
        multiline
      />
      {message && <Notice message={message} />}
      <Button
        testID="event-save"
        label={t('eventForm.save')}
        color={theme.colors.parent}
        busy={busy}
        disabled={!valid}
        onPress={() => void save()}
      />
    </Screen>
  );
}
