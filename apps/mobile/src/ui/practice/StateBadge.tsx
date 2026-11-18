import type { MasteryState } from '@vionx/contracts/client';
import { Text, View } from 'react-native';
import { t } from '../../i18n/index.ts';
import { STATE_LABEL } from '../../lib/practice.ts';
import { useTheme } from '../../theme.ts';

/** Mastery state pill (Master Spec §10.2). */
export function StateBadge({ state, testID }: { state: MasteryState; testID?: string }) {
  const theme = useTheme();
  const c = theme.colors;
  const tone: Record<MasteryState, [string, string]> = {
    NOT_LEARNED: [c.surfaceMuted, c.textMuted],
    INTRODUCED: [c.surfaceMuted, c.text],
    LEARNING: [c.warningBg, c.text],
    PROFICIENT: [c.successBg, c.success],
    MASTERED: [c.success, c.onPrimary],
    RETAINED: [c.primary, c.onPrimary],
  };
  const [background, color] = tone[state];
  return (
    <View
      testID={testID}
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 2,
        borderRadius: theme.radii.lg,
        backgroundColor: background,
      }}
    >
      <Text style={[theme.typography.caption, { color }]}>{t(STATE_LABEL[state])}</Text>
    </View>
  );
}
