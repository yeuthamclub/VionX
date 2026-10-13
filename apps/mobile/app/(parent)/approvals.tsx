import type { ApprovalItem } from '@vionx/contracts/client';
import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { parentApi } from '../../src/api.ts';
import { t } from '../../src/i18n/index.ts';
import { describeError, unwrap } from '../../src/lib/api-error.ts';
import { dayLabel, verificationLabel } from '../../src/lib/tasks.ts';
import { useTheme } from '../../src/theme.ts';
import { Button } from '../../src/ui/Button.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { StateView } from '../../src/ui/StateView.tsx';
import { TextField } from '../../src/ui/TextField.tsx';
import { useLoad } from '../../src/ui/useLoad.ts';

/** Approvals inbox: task days waiting for the parent, with the proof photo; approve or send back. */
export default function Approvals() {
  const theme = useTheme();
  const { state, reload } = useLoad(() => unwrap(parentApi.GET('/api/v1/approvals')));
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);

  return (
    <Screen title={t('approvals.title')} testID="screen-approvals">
      {message && <Notice message={message.text} tone={message.tone} testID="approvals-message" />}
      <StateView
        state={state}
        reload={reload}
        isEmpty={(data) => data.items.length === 0}
        empty={
          <Text testID="approvals-empty" style={{ color: theme.colors.textMuted }}>
            {t('approvals.empty')}
          </Text>
        }
      >
        {(data) => (
          <View style={{ gap: theme.spacing.lg }}>
            {data.items.map((item) => (
              <ApprovalCard
                key={item.occurrence.id}
                item={item}
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

function ApprovalCard(props: {
  item: ApprovalItem;
  onDone: (text: string, tone: 'error' | 'info') => void;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const { item } = props;
  const o = item.occurrence;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    const options = {
      params: { path: { id: o.taskId } },
      body: { date: o.date, ...(note.trim() ? { note: note.trim() } : {}) },
    };
    try {
      await unwrap(
        decision === 'approve'
          ? parentApi.POST('/api/v1/tasks/{id}/approve', options)
          : parentApi.POST('/api/v1/tasks/{id}/reject', options),
      );
      props.onDone(t(decision === 'approve' ? 'approvals.approved' : 'approvals.rejected'), 'info');
    } catch (e) {
      props.onDone(describeError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      testID={`approval-${o.taskId}`}
      style={{
        gap: theme.spacing.sm,
        padding: theme.spacing.lg,
        backgroundColor: c.surface,
        borderRadius: theme.radii.lg,
        borderWidth: 1,
        borderColor: c.border,
      }}
    >
      <Text style={[theme.typography.bodyStrong, { color: c.text }]}>{o.title}</Text>
      <Text style={[theme.typography.caption, { color: c.textMuted }]}>
        {item.studentName} · {dayLabel(o.date)} · {verificationLabel(o.verificationMode)}
      </Text>
      {item.proofUrl ? (
        <Image
          testID={`approval-photo-${o.taskId}`}
          source={{ uri: item.proofUrl }}
          accessibilityLabel={o.title}
          resizeMode="cover"
          style={{ width: '100%', height: 220, borderRadius: theme.radii.md }}
        />
      ) : (
        o.verificationMode === 'PHOTO_PROOF' && (
          <Text style={{ color: c.textMuted }}>{t('approvals.noPhoto')}</Text>
        )
      )}
      <TextField
        testID={`approval-note-${o.taskId}`}
        label={t('approvals.note')}
        value={note}
        onChangeText={setNote}
        maxLength={300}
      />
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            testID={`approve-${o.taskId}`}
            label={t('approvals.approve')}
            color={c.success}
            busy={busy}
            onPress={() => void decide('approve')}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            testID={`reject-${o.taskId}`}
            label={t('approvals.reject')}
            variant="secondary"
            disabled={busy}
            onPress={() => void decide('reject')}
          />
        </View>
      </View>
    </View>
  );
}
