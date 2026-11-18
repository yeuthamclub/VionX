import {
  ASSESSMENT_TYPES,
  DEFAULT_HOUSEHOLD_TIMEZONE,
  householdToday,
  subjectsForGrade,
} from '@vionx/domain';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { parentApi } from '../../src/api.ts';
import { t, type MessageKey } from '../../src/i18n/index.ts';
import { describeError, unwrap } from '../../src/lib/api-error.ts';
import { gradeFormBody, termText, type GradeForm } from '../../src/lib/dashboard.ts';
import { useTheme } from '../../src/theme.ts';
import { Button } from '../../src/ui/Button.tsx';
import { Chip, ChipRow } from '../../src/ui/Chip.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { TextField } from '../../src/ui/TextField.tsx';

/**
 * Fast grade entry: subject, kind of test, score. Everything else has a default (today, out of
 * 10, the semester of the day). "Save and add another" keeps the subject and the date.
 */
export default function GradeFormScreen() {
  const theme = useTheme();
  const { studentId, grade } = useLocalSearchParams<{ studentId: string; grade?: string }>();
  const subjects = subjectsForGrade(Number(grade) || 6);
  const [form, setForm] = useState<GradeForm>({
    subjectCode: subjects[0]!.code,
    type: 'SHORT_QUIZ',
    assessedOn: householdToday(new Date(), DEFAULT_HOUSEHOLD_TIMEZONE),
    score: '',
    maxScore: '10',
    teacherComment: '',
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);
  const set = (patch: Partial<GradeForm>) => setForm((f) => ({ ...f, ...patch }));
  const parsed = gradeFormBody(form);

  const save = async (another: boolean) => {
    if (!parsed.ok) return;
    setBusy(true);
    setMessage(null);
    try {
      await unwrap(
        parentApi.POST('/api/v1/students/{id}/school-assessments', {
          params: { path: { id: studentId } },
          body: parsed.body,
        }),
      );
      if (!another) return router.back();
      set({ score: '', teacherComment: '' });
      setMessage({ text: t('grades.saved'), tone: 'info' });
    } catch (e) {
      setMessage({ text: describeError(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('grades.add')} testID="screen-grade-form">
      <ChipRow label={t('grades.subject')}>
        {subjects.map((s) => (
          <Chip
            key={s.code}
            testID={`grade-subject-${s.code}`}
            label={s.nameVi}
            selected={form.subjectCode === s.code}
            onPress={() => set({ subjectCode: s.code })}
          />
        ))}
      </ChipRow>
      <ChipRow label={t('grades.kind')}>
        {ASSESSMENT_TYPES.map((ty) => (
          <Chip
            key={ty}
            testID={`grade-type-${ty}`}
            label={t(`grades.type.${ty}` as MessageKey)}
            selected={form.type === ty}
            onPress={() => set({ type: ty })}
          />
        ))}
      </ChipRow>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 2 }}>
          <TextField
            testID="grade-score"
            label={t('grades.score')}
            value={form.score}
            onChangeText={(score) => set({ score })}
            keyboardType="decimal-pad"
            maxLength={6}
            autoFocus
          />
        </View>
        <View style={{ flex: 1 }}>
          <TextField
            testID="grade-max"
            label={t('grades.maxScore')}
            value={form.maxScore}
            onChangeText={(maxScore) => set({ maxScore })}
            keyboardType="decimal-pad"
            maxLength={6}
          />
        </View>
      </View>
      <TextField
        testID="grade-date"
        label={t('grades.date')}
        value={form.assessedOn}
        onChangeText={(assessedOn) => set({ assessedOn })}
        maxLength={10}
      />
      {parsed.ok && (
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
          {termText(form.assessedOn)}
        </Text>
      )}
      <TextField
        testID="grade-comment"
        label={t('grades.teacherComment')}
        value={form.teacherComment}
        onChangeText={(teacherComment) => set({ teacherComment })}
        maxLength={500}
        multiline
      />
      {!parsed.ok && form.score.trim() !== '' && (
        <Notice
          testID="grade-invalid"
          message={t(`grades.invalid.${parsed.field}` as MessageKey)}
        />
      )}
      {message && <Notice testID="grade-message" message={message.text} tone={message.tone} />}
      <Button
        testID="grade-save"
        label={t('common.save')}
        color={theme.colors.parent}
        busy={busy}
        disabled={!parsed.ok}
        onPress={() => void save(false)}
      />
      <Button
        testID="grade-save-another"
        label={t('grades.saveAnother')}
        variant="secondary"
        disabled={!parsed.ok || busy}
        onPress={() => void save(true)}
      />
    </Screen>
  );
}
