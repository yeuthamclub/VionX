import type { PracticeGroup } from '@vionx/contracts/client';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { t } from '../../i18n/index.ts';
import { plainText } from '../../lib/practice.ts';
import { useTheme } from '../../theme.ts';
import { Media } from './Media.tsx';
import { RichText } from './RichText.tsx';
import { SpeakButton } from './SpeakButton.tsx';

/** Shared passage of a group: stays above its items, can be folded to save room. */
export function GroupStimulus({ group, young }: { group: PracticeGroup; young: boolean }) {
  const theme = useTheme();
  const c = theme.colors;
  const [open, setOpen] = useState(true);
  return (
    <View
      testID="group-stimulus"
      style={{
        borderRadius: theme.radii.md,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        padding: theme.spacing.md,
        gap: theme.spacing.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Pressable
          testID="group-toggle"
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(!open)}
          style={{ flex: 1, minHeight: theme.touchTarget.default, justifyContent: 'center' }}
        >
          <Text style={[theme.typography.bodyStrong, { color: c.text }]}>
            {open ? '▾' : '▸'} {group.title}
          </Text>
          <Text style={[theme.typography.caption, { color: c.textMuted }]}>
            {t('practice.groupProgress', { n: group.position, total: group.total })}
          </Text>
        </Pressable>
        <SpeakButton
          testID="speak-group"
          text={group.ttsText ?? plainText(group.bodyMd)}
          lang={group.ttsLang}
        />
      </View>
      {open && (
        <View testID="group-body" style={{ gap: theme.spacing.sm }}>
          {group.media.map((m) => (
            <Media key={m.id} media={m} size={180} />
          ))}
          <RichText
            source={group.bodyMd}
            style={young ? theme.typography.childBody : theme.typography.body}
          />
        </View>
      )}
    </View>
  );
}
