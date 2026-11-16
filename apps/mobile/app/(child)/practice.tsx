import type {
  AnswerResponse,
  HintResponse,
  LearningSession,
  LearningSessionSummary,
  NextItemResponse,
  PracticeHint,
} from '@vionx/contracts/client';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { childApi } from '../../src/api.ts';
import { t } from '../../src/i18n/index.ts';
import { AppError, describeError, unwrap } from '../../src/lib/api-error.ts';
import {
  emptyDraft,
  feedbackKey,
  isComplete,
  plainText,
  speechFor,
  toResponse,
  type Draft,
} from '../../src/lib/practice.ts';
import { speak, stopSpeaking } from '../../src/lib/speech.ts';
import { childToken } from '../../src/state/device.ts';
import { useTheme } from '../../src/theme.ts';
import { Button } from '../../src/ui/Button.tsx';
import { ProgressBar } from '../../src/ui/CapBar.tsx';
import { Chip, ChipRow } from '../../src/ui/Chip.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { GroupStimulus } from '../../src/ui/practice/GroupStimulus.tsx';
import { ItemView } from '../../src/ui/practice/ItemView.tsx';
import { RichText } from '../../src/ui/practice/RichText.tsx';
import { SpeakButton } from '../../src/ui/practice/SpeakButton.tsx';
import { StateBadge } from '../../src/ui/practice/StateBadge.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { StateView } from '../../src/ui/StateView.tsx';
import { useLoad } from '../../src/ui/useLoad.ts';

const REPORT_REASONS = [
  'WRONG_ANSWER',
  'UNCLEAR',
  'TYPO',
  'BAD_MEDIA',
  'BAD_AUDIO',
  'TOO_HARD',
] as const;

interface View_ {
  session: LearningSession;
  next: NextItemResponse;
  draft: Draft;
  hints: PracticeHint[];
  solution: string | null;
  answer: AnswerResponse | null;
  summary: LearningSessionSummary | null;
}

/** Child: one practice session — item, hint ladder, feedback, report, then the summary. */
export default function Practice() {
  const theme = useTheme();
  const c = theme.colors;
  const params = useLocalSearchParams<{ nodeId?: string; mode?: string; subject?: string }>();
  const sessionUuid = useRef(Crypto.randomUUID());
  const answerUuid = useRef(Crypto.randomUUID());
  const shownAt = useRef(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);

  const fetchNext = (id: string) =>
    unwrap(childApi.GET('/api/v1/learning/sessions/{id}/next', { params: { path: { id } } }));

  const { state, reload, setState } = useLoad<View_>(async () => {
    try {
      const { session } = await unwrap(
        childApi.POST('/api/v1/learning/sessions', {
          body: {
            clientUuid: sessionUuid.current,
            ...(params.nodeId ? { nodeId: params.nodeId } : {}),
            ...(params.mode === 'REVIEW' ? { mode: 'REVIEW' as const } : {}),
            ...(params.subject ? { subject: params.subject } : {}),
          },
        }),
      );
      const next = await fetchNext(session.id);
      return fresh(session, next);
    } catch (e) {
      if (e instanceof AppError && e.status === 401) {
        await childToken.clear();
        router.replace('/child');
      }
      throw e;
    }
  });
  const view = state.kind === 'ready' ? state.data : null;
  const item = view?.next.item ?? null;

  // Read the item aloud when it appears (Grade 1-3 or the subject profile says so).
  useEffect(() => {
    if (item && view?.session.readAloud) speak(speechFor(item), item.ttsLang);
    shownAt.current = Date.now();
    return stopSpeaking;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.seed]);

  function fresh(session: LearningSession, next: NextItemResponse): View_ {
    return {
      session,
      next,
      draft: next.item ? emptyDraft(next.item) : emptyDraft({ type: 'single_choice', blanks: 0 }),
      hints: next.item?.hints ?? [],
      solution: null,
      answer: null,
      summary: null,
    };
  }

  const set = (patch: Partial<View_>) =>
    view && setState({ kind: 'ready', data: { ...view, ...patch } });

  /** Runs a server action; failures (offline, conflict) show a message and can be retried. */
  async function act(run: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const id = view?.session.id ?? '';
  const young = view?.session.youngMode ?? false;

  const hint = () =>
    act(async () => {
      const h: HintResponse = await unwrap(
        childApi.POST('/api/v1/learning/sessions/{id}/hint', { params: { path: { id } } }),
      );
      const hints = [...view!.hints.slice(0, h.level - 1), h.hint];
      set({ hints, solution: h.workedSolutionMd });
      if (view!.session.readAloud && item)
        speak(h.hint.ttsText ?? plainText(h.hint.md), item.ttsLang);
    });

  const submit = () =>
    act(async () => {
      const answer = await unwrap(
        childApi.POST('/api/v1/learning/sessions/{id}/answers', {
          params: { path: { id } },
          body: {
            clientUuid: answerUuid.current,
            itemId: item!.id,
            response: toResponse(item!, view!.draft),
            responseMs: Math.min(3_600_000, Date.now() - shownAt.current),
          },
        }),
      );
      set({ answer });
      if (view!.session.readAloud) {
        speak(t(feedbackKey(answer.isCorrect, young)), 'vi');
      }
    });

  const finish = () =>
    act(async () => {
      const done = await unwrap(
        childApi.POST('/api/v1/learning/sessions/{id}/finish', { params: { path: { id } } }),
      );
      set({ session: done.session, summary: done.summary });
    });

  const proceed = () =>
    act(async () => {
      const next = await fetchNext(id);
      answerUuid.current = Crypto.randomUUID();
      setReporting(false);
      setReported(false);
      if (next.done) {
        const done = await unwrap(
          childApi.POST('/api/v1/learning/sessions/{id}/finish', { params: { path: { id } } }),
        );
        setState({ kind: 'ready', data: { ...fresh(done.session, next), summary: done.summary } });
      } else {
        setState({ kind: 'ready', data: fresh(view!.session, next) });
      }
    });

  const report = (reason: (typeof REPORT_REASONS)[number]) =>
    act(async () => {
      await unwrap(
        childApi.POST('/api/v1/items/{id}/report', {
          params: { path: { id: item!.id } },
          body: { reason, ...(item!.seed === null ? {} : { variantSeed: item!.seed }) },
        }),
      );
      setReporting(false);
      setReported(true);
    });

  return (
    <Screen testID="screen-practice">
      <StateView state={state} reload={reload}>
        {(v) => {
          if (v.summary) return <Summary summary={v.summary} young={young} />;
          if (!v.next.item) {
            // Nothing to serve (empty pool or time up before the first item): close the session.
            return (
              <View testID="practice-empty" style={{ gap: theme.spacing.md }}>
                <Text style={[theme.typography.body, { color: c.textMuted }]}>
                  {t('practice.noItems')}
                </Text>
                <Button
                  testID="practice-finish"
                  label={t('practice.finish')}
                  busy={busy}
                  onPress={finish}
                />
              </View>
            );
          }
          const current = v.next.item;
          const progress = v.answer?.progress ?? v.next.progress;
          const answered = v.answer !== null;
          return (
            <View style={{ gap: theme.spacing.lg }}>
              <ProgressBar
                testID="practice-progress"
                fraction={progress.answered / progress.target}
                caption={t('practice.progress', { n: progress.answered, total: progress.target })}
                color={c.child}
              />
              {v.session.mode === 'DIAGNOSTIC' && (
                <Notice tone="info" message={t('practice.diagnostic')} />
              )}
              {v.next.group && <GroupStimulus group={v.next.group} young={young} />}
              <ItemView
                item={current}
                draft={v.draft}
                young={young}
                disabled={answered || busy}
                onChange={(draft) => set({ draft })}
              />

              {v.hints.map((h, i) => (
                <View
                  key={i}
                  testID={`hint-${i + 1}`}
                  style={{
                    flexDirection: 'row',
                    gap: theme.spacing.sm,
                    padding: theme.spacing.md,
                    borderRadius: theme.radii.md,
                    backgroundColor: c.warningBg,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[theme.typography.caption, { color: c.textMuted }]}>
                      {t('practice.hintLevel', { n: i + 1, total: current.hintsTotal })}
                    </Text>
                    <RichText
                      source={h.md}
                      style={young ? theme.typography.childBody : theme.typography.body}
                    />
                  </View>
                  <SpeakButton
                    testID={`speak-hint-${i + 1}`}
                    text={h.ttsText ?? plainText(h.md)}
                    lang={current.ttsLang}
                  />
                </View>
              ))}

              {answered ? (
                <View testID="practice-feedback" style={{ gap: theme.spacing.md }}>
                  <Text
                    testID={v.answer!.isCorrect ? 'feedback-correct' : 'feedback-wrong'}
                    style={[
                      theme.typography.heading,
                      { color: v.answer!.isCorrect ? c.success : c.child },
                    ]}
                  >
                    {t(feedbackKey(v.answer!.isCorrect, young))}
                  </Text>
                  {v.answer!.feedback && (
                    <RichText testID="distractor-feedback" source={v.answer!.feedback.md} />
                  )}
                  {v.answer!.explanationMd !== '' && <RichText source={v.answer!.explanationMd} />}
                  {(v.answer!.workedSolutionMd ?? v.solution) && (
                    <RichText
                      testID="worked-solution"
                      source={(v.answer!.workedSolutionMd ?? v.solution)!}
                    />
                  )}
                  <Button
                    testID="practice-continue"
                    label={t('common.continue')}
                    color={c.child}
                    busy={busy}
                    onPress={proceed}
                  />
                </View>
              ) : (
                <View style={{ gap: theme.spacing.sm }}>
                  {v.solution && <RichText testID="worked-solution" source={v.solution} />}
                  <Button
                    testID="practice-submit"
                    label={t('practice.submit')}
                    color={c.child}
                    disabled={!isComplete(current, v.draft)}
                    busy={busy}
                    onPress={submit}
                  />
                  {current.hintsTotal > 0 && v.hints.length < current.hintsTotal && (
                    <Button
                      testID="practice-hint"
                      label={t('practice.hint', {
                        n: v.hints.length + 1,
                        total: current.hintsTotal,
                      })}
                      variant="secondary"
                      disabled={busy}
                      onPress={hint}
                    />
                  )}
                </View>
              )}

              <Notice testID="practice-error" message={error} />
              {reported ? (
                <Notice testID="report-sent" tone="info" message={t('practice.reported')} />
              ) : reporting ? (
                <ChipRow label={t('practice.reportWhy')}>
                  {REPORT_REASONS.map((reason) => (
                    <Chip
                      key={reason}
                      testID={`report-${reason}`}
                      label={t(`practice.report.${reason}`)}
                      selected={false}
                      onPress={() => void report(reason)}
                    />
                  ))}
                </ChipRow>
              ) : (
                <Button
                  testID="practice-report"
                  label={t('practice.reportOpen')}
                  variant="secondary"
                  onPress={() => setReporting(true)}
                />
              )}
              <Button
                testID="practice-finish"
                label={t('practice.finishEarly')}
                variant="secondary"
                disabled={busy}
                onPress={finish}
              />
            </View>
          );
        }}
      </StateView>
      {view?.summary && (
        <Button
          testID="practice-done"
          label={t('common.done')}
          color={c.child}
          onPress={() => router.back()}
        />
      )}
    </Screen>
  );
}

/** Session summary: score, XP, skill states and the worked solutions of wrong answers. */
function Summary({ summary, young }: { summary: LearningSessionSummary; young: boolean }) {
  const theme = useTheme();
  const c = theme.colors;
  return (
    <View testID="practice-summary" style={{ gap: theme.spacing.md }}>
      <Text style={[theme.typography.title, { color: c.text }]}>
        {young ? t('practice.summaryYoung') : t('practice.summary')}
      </Text>
      <Text testID="summary-score" style={[theme.typography.heading, { color: c.child }]}>
        {t('practice.score', { n: summary.correct, total: summary.answered })}
      </Text>
      <Text testID="summary-xp" style={[theme.typography.body, { color: c.reward }]}>
        {t('practice.xp', { n: summary.xp })}
      </Text>
      {summary.skills.map((s) => (
        <View
          key={s.skillId}
          testID={`summary-skill-${s.skillId}`}
          style={{ gap: theme.spacing.xs }}
        >
          <Text style={[theme.typography.body, { color: c.text }]}>{s.title}</Text>
          <StateBadge state={s.state} />
        </View>
      ))}
      {summary.solutions.length > 0 && (
        <Text style={[theme.typography.bodyStrong, { color: c.text }]}>
          {t('practice.solutions')}
        </Text>
      )}
      {summary.solutions.map((s) => (
        <View
          key={s.itemId}
          testID={`solution-${s.itemId}`}
          style={{
            gap: theme.spacing.xs,
            padding: theme.spacing.md,
            borderRadius: theme.radii.md,
            backgroundColor: c.surface,
            borderWidth: 1,
            borderColor: c.border,
          }}
        >
          <RichText source={s.stemMd} style={theme.typography.bodyStrong} />
          {s.workedSolutionMd !== '' && <RichText source={s.workedSolutionMd} />}
        </View>
      ))}
    </View>
  );
}
