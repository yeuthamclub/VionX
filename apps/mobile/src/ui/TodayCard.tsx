import type { TodayItem } from '@vionx/contracts/client';
import { Text, View } from 'react-native';
import { t } from '../i18n/index.ts';
import { childActions, itemTitle, kindLabel, reasonText, statusLabel } from '../lib/today.ts';
import { useTheme } from '../theme.ts';
import { Button } from './Button.tsx';

/**
 * One Today item. Child mode: big card with duration, reward hint and "start" / "done" / "skip".
 * Parent mode: the reasons behind the priority, and pin / remove.
 */
export function TodayCard(props: {
  item: TodayItem;
  mode: 'child' | 'parent';
  busy?: boolean;
  onStart?: () => void;
  onComplete?: () => void;
  onSkip?: () => void;
  onPin?: (pinned: boolean) => void;
  onRemove?: (removed: boolean) => void;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const { item } = props;
  const child = props.mode === 'child';
  const can = childActions(item);
  const statusColor =
    item.status === 'DONE'
      ? c.success
      : item.status === 'PENDING_APPROVAL'
        ? c.warning
        : item.status === 'REMOVED'
          ? c.danger
          : c.textMuted;
  return (
    <View
      testID={`today-item-${item.id}`}
      style={{
        gap: theme.spacing.sm,
        padding: child ? theme.spacing.lg : theme.spacing.md,
        backgroundColor: c.surface,
        borderRadius: theme.radii.lg,
        borderWidth: 1,
        borderColor: c.border,
        borderLeftWidth: 4,
        borderLeftColor: item.pinned ? c.parent : statusColor,
      }}
    >
      <Text style={[theme.typography.caption, { color: c.textMuted }]}>
        {[
          kindLabel(item.kind),
          item.kind === 'EXAM_PREP' && item.detail.examTitle ? String(item.detail.examTitle) : null,
          item.pinned ? t('today.pinned') : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <Text
        style={[
          child ? theme.typography.childBody : theme.typography.bodyStrong,
          { color: c.text },
        ]}
      >
        {itemTitle(item)}
      </Text>
      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <Text
          testID={`today-minutes-${item.id}`}
          style={[theme.typography.caption, { color: c.textMuted }]}
        >
          {t('today.minutes', { n: item.minutes })}
        </Text>
        {item.rewardXp > 0 && (
          <Text
            testID={`today-reward-${item.id}`}
            style={[theme.typography.caption, { color: c.reward }]}
          >
            {t(item.link.type === 'SESSION' ? 'today.rewardUpTo' : 'childTasks.xp', {
              n: item.rewardXp,
            })}
          </Text>
        )}
        <Text
          testID={`today-status-${item.id}`}
          style={[theme.typography.caption, { color: statusColor }]}
        >
          {statusLabel(item.status)}
        </Text>
      </View>
      {!child && (
        <View testID={`today-reasons-${item.id}`} style={{ gap: theme.spacing.xs }}>
          <Text style={[theme.typography.caption, { color: c.text }]}>
            {t('today.priority', { n: item.priority })}
          </Text>
          {item.reasons.map((r) => (
            <Text key={r.code} style={[theme.typography.caption, { color: c.textMuted }]}>
              {`• ${reasonText(r)}`}
            </Text>
          ))}
        </View>
      )}
      {child && can.start && props.onStart && (
        <Button
          testID={`today-start-${item.id}`}
          label={t(item.status === 'STARTED' ? 'today.continue' : 'today.start')}
          color={c.child}
          busy={props.busy}
          onPress={props.onStart}
        />
      )}
      {child && can.complete && props.onComplete && (
        <Button
          testID={`today-complete-${item.id}`}
          label={can.needsPhoto ? t('childTasks.photo') : t('childTasks.done')}
          color={c.child}
          busy={props.busy}
          onPress={props.onComplete}
        />
      )}
      {child && can.skip && props.onSkip && (
        <Button
          testID={`today-skip-${item.id}`}
          label={t('today.skip')}
          variant="secondary"
          disabled={props.busy}
          onPress={props.onSkip}
        />
      )}
      {!child && (props.onPin || props.onRemove) && (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          {props.onPin && item.status !== 'REMOVED' && (
            <View style={{ flex: 1 }}>
              <Button
                testID={`today-pin-${item.id}`}
                label={t(item.pinned ? 'today.unpin' : 'today.pin')}
                variant="secondary"
                disabled={props.busy}
                onPress={() => props.onPin!(!item.pinned)}
              />
            </View>
          )}
          {props.onRemove && (
            <View style={{ flex: 1 }}>
              <Button
                testID={`today-remove-${item.id}`}
                label={t(item.status === 'REMOVED' ? 'today.restore' : 'today.remove')}
                variant="secondary"
                disabled={props.busy}
                onPress={() => props.onRemove!(item.status !== 'REMOVED')}
              />
            </View>
          )}
        </View>
      )}
    </View>
  );
}
