import type { Task, TaskTemplate, TaskType, VerificationMode } from '@vionx/contracts/client';
import { isValidDay, TASK_TYPES, VERIFICATION_MODES } from '@vionx/domain';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { parentApi } from '../../src/api.ts';
import { t, type MessageKey } from '../../src/i18n/index.ts';
import { describeError, unwrap } from '../../src/lib/api-error.ts';
import {
  repeatToRRule,
  rruleToRepeat,
  timeWindowError,
  verificationLabel,
  weekdayLabel,
  type RepeatPreset,
} from '../../src/lib/tasks.ts';
import { useTheme } from '../../src/theme.ts';
import { Button } from '../../src/ui/Button.tsx';
import { Chip, ChipRow } from '../../src/ui/Chip.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { StateView } from '../../src/ui/StateView.tsx';
import { TextField } from '../../src/ui/TextField.tsx';
import { useLoad } from '../../src/ui/useLoad.ts';

const REPEATS: RepeatPreset[] = ['ONCE', 'DAILY', 'SCHOOL_DAYS', 'WEEKLY'];
// Children complete by hand; SYSTEM_VERIFIED tasks come from practice sessions (M06/M07).
const MODES = VERIFICATION_MODES.filter((m) => m !== 'SYSTEM_VERIFIED');

/** Task form: create (`studentId`) or edit / archive (`taskId`). Repeat and verification mode. */
export default function TaskForm() {
  const { studentId, taskId } = useLocalSearchParams<{ studentId?: string; taskId?: string }>();
  const { state, reload } = useLoad(async () => {
    if (taskId) {
      const res = await unwrap(
        parentApi.GET('/api/v1/tasks/{id}', { params: { path: { id: taskId } } }),
      );
      return { task: res.task as Task | null, templates: [] as TaskTemplate[] };
    }
    const res = await unwrap(parentApi.GET('/api/v1/task-templates'));
    return { task: null, templates: res.templates };
  }, [studentId, taskId]);

  return (
    <Screen
      title={taskId ? t('taskForm.editTitle') : t('taskForm.newTitle')}
      testID="screen-task-form"
    >
      <StateView state={state} reload={reload}>
        {(data) => (
          <TaskFields
            studentId={studentId ?? data.task?.studentId ?? ''}
            task={data.task}
            templates={data.templates}
          />
        )}
      </StateView>
    </Screen>
  );
}

function TaskFields(props: { studentId: string; task: Task | null; templates: TaskTemplate[] }) {
  const theme = useTheme();
  const c = theme.colors;
  const task = props.task;
  const initialRepeat = rruleToRepeat(task?.rrule ?? null);
  const [title, setTitle] = useState(task?.title ?? '');
  const [type, setType] = useState<TaskType>(task?.type ?? 'HOMEWORK');
  const [description, setDescription] = useState(task?.description ?? '');
  const [startsOn, setStartsOn] = useState(task?.startsOn ?? '');
  const [repeat, setRepeat] = useState<RepeatPreset>(task ? initialRepeat.preset : 'DAILY');
  const [weekdays, setWeekdays] = useState<number[]>(initialRepeat.weekdays);
  const [windowStart, setWindowStart] = useState(task?.windowStart ?? '');
  const [windowEnd, setWindowEnd] = useState(task?.windowEnd ?? '');
  const [mode, setMode] = useState<VerificationMode>(task?.verificationMode ?? 'PARENT_APPROVAL');
  const [xp, setXp] = useState(String(task?.rewardXp ?? 10));
  const [required, setRequired] = useState(task?.required ?? true);
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);

  const windowError = timeWindowError(windowStart, windowEnd);
  const dateError = startsOn !== '' && !isValidDay(startsOn) ? 'taskForm.dateInvalid' : null;
  const weekdayError =
    repeat === 'WEEKLY' && weekdays.length === 0 ? 'taskForm.weekdaysRequired' : null;
  const xpValue = Number.parseInt(xp, 10);
  const invalid =
    title.trim() === '' ||
    Boolean(windowError || dateError || weekdayError) ||
    !(xpValue >= 0 && xpValue <= 1000);

  const pick = (tpl: TaskTemplate) => {
    setTemplateId(tpl.id);
    setTitle(tpl.title);
    setType(tpl.type);
    setDescription(tpl.description ?? '');
    setMode(tpl.verificationMode === 'SYSTEM_VERIFIED' ? 'SELF_CHECK' : tpl.verificationMode);
    setXp(String(tpl.rewardXp));
  };

  const toggleWeekday = (d: number) =>
    setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]));

  const save = async () => {
    setBusy(true);
    setMessage(null);
    const fields = {
      type,
      title: title.trim(),
      description: description.trim() || null,
      rrule: repeatToRRule(repeat, weekdays),
      windowStart: windowStart || null,
      windowEnd: windowEnd || null,
      verificationMode: mode,
      rewardXp: xpValue,
      required,
      ...(startsOn ? { startsOn } : {}),
    };
    try {
      const res = task
        ? await unwrap(
            parentApi.PATCH('/api/v1/tasks/{id}', {
              params: { path: { id: task.id } },
              body: fields,
            }),
          )
        : await unwrap(
            parentApi.POST('/api/v1/students/{id}/tasks', {
              params: { path: { id: props.studentId } },
              body: { ...fields, templateId, saveAsTemplate: saveTemplate },
            }),
          );
      setMessage({ text: t('taskForm.saved', { n: res.upcoming.length }), tone: 'info' });
      router.back();
    } catch (e) {
      setMessage({ text: describeError(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const setArchived = (archived: boolean) => {
    const run = async () => {
      setBusy(true);
      try {
        await unwrap(
          parentApi.PATCH('/api/v1/tasks/{id}', {
            params: { path: { id: task!.id } },
            body: { archived },
          }),
        );
        router.back();
      } catch (e) {
        setMessage({ text: describeError(e), tone: 'error' });
      } finally {
        setBusy(false);
      }
    };
    if (!archived) return void run();
    Alert.alert(t('taskForm.archive'), t('taskForm.archiveConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('taskForm.archive'), style: 'destructive', onPress: () => void run() },
    ]);
  };

  return (
    <View style={{ gap: theme.spacing.lg }}>
      {task?.status === 'ARCHIVED' && <Notice tone="info" message={t('taskForm.archived')} />}
      {props.templates.length > 0 && (
        <ChipRow label={t('taskForm.templates')}>
          {props.templates.map((tpl, i) => (
            <Chip
              key={tpl.id}
              testID={`template-${i}`}
              label={tpl.title}
              selected={templateId === tpl.id}
              onPress={() => pick(tpl)}
            />
          ))}
        </ChipRow>
      )}
      <TextField
        testID="task-title"
        label={t('taskForm.name')}
        value={title}
        onChangeText={setTitle}
        maxLength={80}
      />
      <ChipRow label={t('taskForm.type')}>
        {TASK_TYPES.map((ty) => (
          <Chip
            key={ty}
            testID={`task-type-${ty}`}
            label={t(`taskType.${ty}` as MessageKey)}
            selected={type === ty}
            onPress={() => setType(ty)}
          />
        ))}
      </ChipRow>
      <TextField
        testID="task-description"
        label={t('taskForm.description')}
        value={description}
        onChangeText={setDescription}
        maxLength={500}
        multiline
      />
      <ChipRow label={t('taskForm.repeat')}>
        {REPEATS.map((r) => (
          <Chip
            key={r}
            testID={`repeat-${r}`}
            label={t(`repeat.${r}` as MessageKey)}
            selected={repeat === r}
            onPress={() => setRepeat(r)}
          />
        ))}
      </ChipRow>
      {repeat === 'WEEKLY' && (
        <ChipRow label={t('taskForm.weekdays')}>
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <Chip
              key={d}
              testID={`repeat-day-${d}`}
              label={weekdayLabel(d)}
              selected={weekdays.includes(d)}
              onPress={() => toggleWeekday(d)}
            />
          ))}
        </ChipRow>
      )}
      {weekdayError && <Notice message={t(weekdayError)} />}
      <TextField
        testID="task-starts-on"
        label={t('taskForm.startsOn')}
        placeholder={t('calendar.today')}
        value={startsOn}
        onChangeText={setStartsOn}
        maxLength={10}
        error={dateError ? t(dateError) : null}
      />
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <TextField
            testID="task-window-start"
            label={t('taskForm.windowStart')}
            value={windowStart}
            onChangeText={setWindowStart}
            maxLength={5}
          />
        </View>
        <View style={{ flex: 1 }}>
          <TextField
            testID="task-window-end"
            label={t('taskForm.windowEnd')}
            value={windowEnd}
            onChangeText={setWindowEnd}
            maxLength={5}
          />
        </View>
      </View>
      {windowError && <Notice message={t(windowError)} />}
      <ChipRow label={t('taskForm.verification')}>
        {MODES.map((m) => (
          <Chip
            key={m}
            testID={`verification-${m}`}
            label={verificationLabel(m)}
            selected={mode === m}
            onPress={() => setMode(m)}
          />
        ))}
      </ChipRow>
      <TextField
        testID="task-xp"
        label={t('taskForm.rewardXp')}
        keyboardType="number-pad"
        value={xp}
        onChangeText={setXp}
        maxLength={4}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Switch testID="task-required" value={required} onValueChange={setRequired} />
        <Text style={{ color: c.text }}>{t('taskForm.required')}</Text>
      </View>
      {!task && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <Switch
            testID="task-save-template"
            value={saveTemplate}
            onValueChange={setSaveTemplate}
          />
          <Text style={{ color: c.text }}>{t('taskForm.saveTemplate')}</Text>
        </View>
      )}
      {message && <Notice message={message.text} tone={message.tone} />}
      <Button
        testID="task-save"
        label={t('taskForm.save')}
        color={c.parent}
        busy={busy}
        disabled={invalid}
        onPress={() => void save()}
      />
      {task && (
        <Button
          testID="task-archive"
          label={task.status === 'ARCHIVED' ? t('taskForm.restore') : t('taskForm.archive')}
          variant={task.status === 'ARCHIVED' ? 'secondary' : 'danger'}
          disabled={busy}
          onPress={() => setArchived(task.status !== 'ARCHIVED')}
        />
      )}
    </View>
  );
}
