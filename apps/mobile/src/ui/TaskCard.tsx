import type { TaskOccurrence } from '@vionx/contracts/client';
import { Pressable, Text, View } from 'react-native';
import { t } from '../i18n/index.ts';
import { childTaskState, verificationLabel } from '../lib/tasks.ts';
import { useTheme } from '../theme.ts';
import { Button } from './Button.tsx';

/**
 * One task day. Child mode: big card with "done" / "take a photo"; parent mode: compact row with the
 * verification mode, tappable to edit.
 */
export function TaskCard(props: {
  occurrence: TaskOccurrence;
  today: string;
  mode: 'child' | 'parent';
  busy?: boolean;
  onComplete?: () => void;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const o = props.occurrence;
  const state = childTaskState(o, props.today);
  const statusColor =
    o.status === 'COMPLETED'
      ? c.success
      : o.status === 'PENDING_APPROVAL'
        ? c.warning
        : o.status === 'REJECTED'
          ? c.danger
          : c.textMuted;
  const window = o.windowStart && o.windowEnd ? `${o.windowStart} – ${o.windowEnd}` : null;
  const child = props.mode === 'child';
  return (
    <Pressable
      testID={`task-${o.taskId}-${o.date}`}
      accessibilityRole={props.onPress ? 'button' : undefined}
      disabled={!props.onPress}
      onPress={props.onPress}
      style={{
        gap: theme.spacing.sm,
        padding: child ? theme.spacing.lg : theme.spacing.md,
        backgroundColor: c.surface,
        borderRadius: theme.radii.lg,
        borderWidth: 1,
        borderColor: c.border,
        borderLeftWidth: 4,
        borderLeftColor: statusColor,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Text
          style={[
            child ? theme.typography.childBody : theme.typography.bodyStrong,
            { color: c.text, flex: 1 },
          ]}
        >
          {o.title}
        </Text>
        {o.rewardXp > 0 && (
          <Text style={[theme.typography.caption, { color: c.reward }]}>
            {t('childTasks.xp', { n: o.rewardXp })}
          </Text>
        )}
      </View>
      <Text style={[theme.typography.caption, { color: c.textMuted }]}>
        {[window, props.mode === 'parent' ? verificationLabel(o.verificationMode) : null]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <Text
        testID={`task-status-${o.taskId}`}
        style={[theme.typography.caption, { color: statusColor }]}
      >
        {t(state.labelKey)}
      </Text>
      {state.rejectedNote && (
        <Text style={[theme.typography.body, { color: c.text }]}>
          {t('childTasks.parentNote', { note: state.rejectedNote })}
        </Text>
      )}
      {child && state.canComplete && props.onComplete && (
        <Button
          testID={`complete-${o.taskId}`}
          label={state.needsPhoto ? t('childTasks.photo') : t('childTasks.done')}
          color={c.child}
          busy={props.busy}
          onPress={props.onComplete}
        />
      )}
    </Pressable>
  );
}
