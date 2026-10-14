import type { Redemption } from '@vionx/contracts/client';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { parentApi } from '../../src/api.ts';
import { t, type MessageKey } from '../../src/i18n/index.ts';
import { describeError, unwrap } from '../../src/lib/api-error.ts';
import { useTheme } from '../../src/theme.ts';
import { Button } from '../../src/ui/Button.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { StateView } from '../../src/ui/StateView.tsx';
import { TextField } from '../../src/ui/TextField.tsx';
import { useLoad } from '../../src/ui/useLoad.ts';

/** Parent: reward requests from the children — approve (Coin spent) or decline (Coin returned). */
export default function Redemptions() {
  const theme = useTheme();
  const { state, reload } = useLoad(() => unwrap(parentApi.GET('/api/v1/reward-redemptions')));
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);
  return (
    <Screen title={t('redemptions.title')} testID="screen-redemptions">
      {message && (
        <Notice message={message.text} tone={message.tone} testID="redemptions-message" />
      )}
      <StateView
        state={state}
        reload={reload}
        isEmpty={(data) => data.items.length === 0}
        empty={
          <Text testID="redemptions-empty" style={{ color: theme.colors.textMuted }}>
            {t('redemptions.empty')}
          </Text>
        }
      >
        {(data) => (
          <View style={{ gap: theme.spacing.lg }}>
            {data.items.map((r) => (
              <RedemptionCard
                key={r.id}
                r={r}
                onDone={(text, tone) => {
                  setMessage({ text, tone });
                  reload();
                }}
              />
            ))}
          </View>
        )}
      </StateView>
    </Screen>
  );
}

function RedemptionCard(props: {
  r: Redemption;
  onDone: (text: string, tone: 'error' | 'info') => void;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const { r } = props;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    const options = {
      params: { path: { id: r.id } },
      body: note.trim() ? { note: note.trim() } : {},
    };
    try {
      await unwrap(
        decision === 'approve'
          ? parentApi.POST('/api/v1/reward-redemptions/{id}/approve', options)
          : parentApi.POST('/api/v1/reward-redemptions/{id}/reject', options),
      );
      props.onDone(
        t(decision === 'approve' ? 'redemptions.approved' : 'redemptions.rejected'),
        'info',
      );
    } catch (e) {
      props.onDone(describeError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      testID={`redemption-${r.id}`}
      style={{
        gap: theme.spacing.sm,
        padding: theme.spacing.lg,
        backgroundColor: c.surface,
        borderRadius: theme.radii.lg,
        borderWidth: 1,
        borderColor: c.border,
      }}
    >
      <Text style={[theme.typography.bodyStrong, { color: c.text }]}>{r.title}</Text>
      <Text style={[theme.typography.caption, { color: c.textMuted }]}>
        {t('redemptions.line', { name: r.studentName, cost: r.costCoins })} ·{' '}
        {t(`redemptions.status.${r.status}` as MessageKey)}
      </Text>
      {r.decisionNote && <Text style={{ color: c.textMuted }}>{r.decisionNote}</Text>}
      {r.status === 'PENDING' && (
        <>
          <TextField
            testID={`redemption-note-${r.id}`}
            label={t('redemptions.note')}
            value={note}
            onChangeText={setNote}
            maxLength={300}
          />
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                testID={`approve-redemption-${r.id}`}
                label={t('redemptions.approve')}
                color={c.success}
                busy={busy}
                onPress={() => void decide('approve')}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                testID={`reject-redemption-${r.id}`}
                label={t('redemptions.reject')}
                variant="secondary"
                disabled={busy}
                onPress={() => void decide('reject')}
              />
            </View>
          </View>
        </>
      )}
    </View>
  );
}
