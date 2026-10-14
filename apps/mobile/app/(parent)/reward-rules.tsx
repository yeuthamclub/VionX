import type { RewardRulesResponse } from '@vionx/contracts/client';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { parentApi } from '../../src/api.ts';
import { t, type MessageKey } from '../../src/i18n/index.ts';
import { describeError, unwrap } from '../../src/lib/api-error.ts';
import { formToRules, rulesToForm, type RulesForm } from '../../src/lib/rewards.ts';
import { useTheme } from '../../src/theme.ts';
import { Button } from '../../src/ui/Button.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { StateView } from '../../src/ui/StateView.tsx';
import { TextField } from '../../src/ui/TextField.tsx';
import { useLoad } from '../../src/ui/useLoad.ts';

/** Parent: reward rules editor. Each field shows its system cap; values above it are refused. */
export default function RewardRules() {
  const { state, reload, setState } = useLoad(() =>
    unwrap(parentApi.GET('/api/v1/household/reward-rules')),
  );
  return (
    <Screen title={t('rules.title')} subtitle={t('rules.intro')} testID="screen-reward-rules">
      <StateView state={state} reload={reload}>
        {(data) => (
          <RulesEditor
            key={`${data.version}`}
            data={data}
            onSaved={(next) => setState({ kind: 'ready', data: next })}
          />
        )}
      </StateView>
    </Screen>
  );
}

function RulesEditor(props: {
  data: RewardRulesResponse;
  onSaved: (data: RewardRulesResponse) => void;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const caps = props.data.systemCaps;
  const [form, setForm] = useState<RulesForm>(() => rulesToForm(props.data.rules));
  const [errors, setErrors] = useState<Partial<Record<keyof RulesForm, string>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);

  const field = (key: keyof RulesForm, label: string, cap: number | null) => (
    <TextField
      testID={`rules-${key}`}
      label={cap === null ? label : `${label} · ${t('rules.systemCap', { n: cap })}`}
      keyboardType="number-pad"
      maxLength={5}
      value={form[key]}
      onChangeText={(v) => setForm({ ...form, [key]: v })}
      error={errors[key] ?? null}
    />
  );

  const save = async () => {
    const parsed = formToRules(form, caps);
    setErrors(parsed.errors);
    setMessage(null);
    if (!parsed.rules) return;
    setBusy(true);
    try {
      const next = await unwrap(
        parentApi.PATCH('/api/v1/household/reward-rules', { body: parsed.rules }),
      );
      props.onSaved(next);
      setMessage({ text: t('rules.saved'), tone: 'info' });
    } catch (e) {
      setMessage({ text: describeError(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: theme.spacing.md }}>
      <Text testID="rules-version" style={{ color: c.textMuted }}>
        {props.data.custom ? t('rules.custom', { n: props.data.version }) : t('rules.default')}
      </Text>
      {field('weekdayCapCoins', t('rules.weekday'), caps.weekdayCapCoins)}
      {(['tier0', 'tier1', 'tier2', 'tier3'] as const).map((key, i) => (
        <View key={key}>
          {field(
            key,
            t(`rules.tier.${i}` as MessageKey),
            Math.min(caps.weekendTierCaps[i]!, caps.weekendMaxCoins),
          )}
        </View>
      ))}
      {field('readingTasks', t('rules.readingGoal'), null)}
      {field('activityTasks', t('rules.activityGoal'), null)}
      {field('maxGrantsPerDay', t('rules.maxGrants'), caps.maxGrantsPerRulePerDay)}
      {message && <Notice message={message.text} tone={message.tone} testID="rules-message" />}
      <Button testID="rules-save" label={t('rules.save')} busy={busy} onPress={() => void save()} />
    </View>
  );
}
