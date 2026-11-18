import type { TodayItem, TodayResponse } from '@vionx/contracts/client';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { parentApi } from '../../../src/api.ts';
import { t } from '../../../src/i18n/index.ts';
import { describeError, unwrap } from '../../../src/lib/api-error.ts';
import { parseDailyMinutes, todaySections } from '../../../src/lib/today.ts';
import { useTheme } from '../../../src/theme.ts';
import { Button } from '../../../src/ui/Button.tsx';
import { Notice } from '../../../src/ui/Notice.tsx';
import { Screen } from '../../../src/ui/Screen.tsx';
import { StateView } from '../../../src/ui/StateView.tsx';
import { TextField } from '../../../src/ui/TextField.tsx';
import { TodayCard } from '../../../src/ui/TodayCard.tsx';
import { useLoad } from '../../../src/ui/useLoad.ts';

/** Parent: the child's Today with the reasons behind each item; pin, remove, minutes a day. */
export default function StudentToday() {
  const theme = useTheme();
  const c = theme.colors;
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [minutes, setMinutes] = useState('');
  const { state, reload, setState } = useLoad(async () => {
    const today = await unwrap(
      parentApi.GET('/api/v1/students/{id}/today', { params: { path: { id } } }),
    );
    setMinutes(today.dailyMinutes === null ? '' : String(today.dailyMinutes));
    return today;
  }, [id]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const apply = async (key: string, call: () => Promise<TodayResponse>) => {
    setBusyId(key);
    setMessage(null);
    try {
      const today = await call();
      setState({ kind: 'ready', data: today });
    } catch (e) {
      setMessage(describeError(e));
    } finally {
      setBusyId(null);
    }
  };
  const pin = (item: TodayItem, pinned: boolean) =>
    apply(item.id, async () => {
      const res = await unwrap(
        parentApi.POST('/api/v1/today-items/{id}/pin', {
          params: { path: { id: item.id } },
          body: { pinned },
        }),
      );
      return res.today;
    });
  const remove = (item: TodayItem, removed: boolean) =>
    apply(item.id, async () => {
      const res = await unwrap(
        parentApi.POST('/api/v1/today-items/{id}/remove', {
          params: { path: { id: item.id } },
          body: { removed },
        }),
      );
      return res.today;
    });
  const daily = parseDailyMinutes(minutes);
  const saveMinutes = () =>
    apply('minutes', () =>
      unwrap(
        parentApi.PUT('/api/v1/students/{id}/today/settings', {
          params: { path: { id } },
          body: { dailyMinutes: daily.ok ? daily.value : null },
        }),
      ),
    );

  const cards = (title: string, items: TodayItem[], testID: string) =>
    items.length > 0 && (
      <View testID={testID} style={{ gap: theme.spacing.sm }}>
        <Text style={[theme.typography.heading, { color: c.text }]}>{title}</Text>
        {items.map((item) => (
          <TodayCard
            key={item.id}
            item={item}
            mode="parent"
            busy={busyId === item.id}
            onPin={(pinned) => void pin(item, pinned)}
            onRemove={(removed) => void remove(item, removed)}
          />
        ))}
      </View>
    );

  return (
    <Screen
      title={t('parentToday.title')}
      {...(name ? { subtitle: name } : {})}
      testID="screen-parent-today"
    >
      {message && <Notice message={message} testID="parent-today-message" />}
      <StateView state={state} reload={reload}>
        {(today) => {
          const sections = todaySections(today);
          return (
            <>
              <Text
                testID="parent-today-summary"
                style={[theme.typography.body, { color: c.textMuted }]}
              >
                {t('parentToday.summary', {
                  budget: today.budgetMinutes,
                  free: today.freeMinutes,
                  done: today.doneMinutes,
                  planned: today.plannedMinutes,
                })}
              </Text>
              <TextField
                testID="today-daily-minutes"
                label={t('parentToday.dailyMinutes', { n: today.sessionMinutes * 3 })}
                value={minutes}
                onChangeText={setMinutes}
                keyboardType="number-pad"
                maxLength={3}
              />
              {!daily.ok && <Notice message={t('parentToday.dailyInvalid')} />}
              <Button
                testID="today-save-minutes"
                label={t('parentToday.saveMinutes')}
                color={c.parent}
                busy={busyId === 'minutes'}
                disabled={!daily.ok || daily.value === today.dailyMinutes}
                onPress={() => void saveMinutes()}
              />
              {today.items.length === 0 && (
                <Text
                  testID="parent-today-empty"
                  style={[theme.typography.body, { color: c.textMuted }]}
                >
                  {t('parentToday.empty')}
                </Text>
              )}
              {cards(t('today.now'), sections.now, 'today-now')}
              {cards(t('today.later'), sections.later, 'today-later')}
              {cards(t('today.done'), sections.done, 'today-done')}
              {cards(t('today.removed'), sections.removed, 'today-removed')}
            </>
          );
        }}
      </StateView>
    </Screen>
  );
}
