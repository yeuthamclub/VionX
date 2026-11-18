import type { PracticeItem, PracticeOption } from '@vionx/contracts/client';
import type { ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { t } from '../../i18n/index.ts';
import { KEYPAD_KEYS, pressKey, speechFor, tapOption, type Draft } from '../../lib/practice.ts';
import { useTheme } from '../../theme.ts';
import { Media } from './Media.tsx';
import { RichText } from './RichText.tsx';
import { SpeakButton } from './SpeakButton.tsx';

interface Props {
  item: PracticeItem;
  draft: Draft;
  onChange: (draft: Draft) => void;
  /** Grade 1-3 mode: larger text and touch targets. */
  young: boolean;
  /** Locked after the answer was sent. */
  disabled?: boolean;
}

/** One answer button: text and/or picture, selected state, optional order badge. */
function OptionButton(props: {
  option: PracticeOption;
  selected: boolean;
  onPress: () => void;
  young: boolean;
  disabled?: boolean | undefined;
  badge?: string | undefined;
  picture?: boolean | undefined;
  testID: string;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const { option } = props;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected, disabled: Boolean(props.disabled) }}
      accessibilityLabel={option.text ?? option.media?.alt ?? option.id}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: props.young ? 64 : theme.touchTarget.child,
        minWidth: props.picture ? 140 : undefined,
        flexGrow: props.picture ? 1 : undefined,
        borderRadius: theme.radii.md,
        borderWidth: 2,
        borderColor: props.selected ? c.child : c.border,
        backgroundColor: props.selected ? c.warningBg : c.surface,
        padding: theme.spacing.md,
        flexDirection: props.picture ? 'column' : 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {props.badge !== undefined && (
        <Text style={[theme.typography.bodyStrong, { color: c.child }]}>{props.badge}</Text>
      )}
      {option.media && <Media media={option.media} size={props.picture ? 110 : 48} />}
      {option.text !== null && (
        <View style={{ flexShrink: 1, flexGrow: props.picture ? 0 : 1 }}>
          <RichText
            source={option.text}
            style={props.young ? theme.typography.childBody : theme.typography.body}
          />
        </View>
      )}
    </Pressable>
  );
}

function Keypad(props: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean | undefined;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const key = (label: string, wide = false) => (
    <Pressable
      key={label}
      testID={`key-${label}`}
      accessibilityRole="button"
      accessibilityLabel={label === '⌫' ? t('practice.backspace') : label}
      disabled={props.disabled}
      onPress={() => props.onChange(pressKey(props.value, label))}
      style={({ pressed }) => ({
        width: wide ? '100%' : '31%',
        minHeight: 64,
        borderRadius: theme.radii.md,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={[theme.typography.title, { color: c.text }]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View
        testID="numeric-display"
        style={{
          minHeight: 64,
          borderRadius: theme.radii.md,
          borderWidth: 2,
          borderColor: c.child,
          backgroundColor: c.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={[theme.typography.display, { color: c.text }]}>{props.value || ' '}</Text>
      </View>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: theme.spacing.sm,
          justifyContent: 'space-between',
        }}
      >
        {KEYPAD_KEYS.map((k) => key(k))}
      </View>
      {key('−', true)}
    </View>
  );
}

/** The gaps of a word_bank / the chosen order of an ordering item. */
function Slots(props: {
  slots: (string | null)[];
  item: PracticeItem;
  onTap: (id: string) => void;
  disabled?: boolean | undefined;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const text = (id: string | null) => props.item.options.find((o) => o.id === id)?.text ?? '';
  return (
    <View
      testID="answer-slots"
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, minHeight: 56 }}
    >
      {props.slots.map((id, i) => (
        <Pressable
          key={i}
          testID={`slot-${i}`}
          accessibilityRole="button"
          disabled={props.disabled || id === null}
          onPress={() => id && props.onTap(id)}
          style={{
            minWidth: 72,
            minHeight: theme.touchTarget.child,
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.radii.md,
            borderWidth: 2,
            borderStyle: id === null ? 'dashed' : 'solid',
            borderColor: id === null ? c.border : c.child,
            backgroundColor: id === null ? c.surfaceMuted : c.warningBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={[theme.typography.bodyStrong, { color: c.text }]}>
            {id === null ? `${i + 1}` : `${i + 1}. ${text(id)}`}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Stem with pictures and a speaker button, then the answer control of the item type: choice
 * (single, multi, picture, spelling), true/false, numeric keypad, fill blank, word bank, ordering
 * and matching. Ordering and matching work by tapping, so young children never have to drag.
 */
export function ItemView({ item, draft, onChange, young, disabled }: Props) {
  const theme = useTheme();
  const c = theme.colors;
  const tap = (id: string) => onChange(tapOption(item, draft, id));
  const column = (children: ReactNode) => <View style={{ gap: theme.spacing.sm }}>{children}</View>;
  const option = (o: PracticeOption, selected: boolean, badge?: string, picture = false) => (
    <OptionButton
      key={o.id}
      testID={`option-${o.id}`}
      option={o}
      selected={selected}
      badge={badge}
      picture={picture}
      young={young}
      disabled={disabled}
      onPress={() => tap(o.id)}
    />
  );

  let control: ReactNode;
  switch (item.type) {
    case 'single_choice':
    case 'spelling_choice':
    case 'multi_choice':
      control = column(item.options.map((o) => option(o, draft.optionIds.includes(o.id))));
      break;
    case 'picture_choice':
      control = (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {item.options.map((o) => option(o, draft.optionIds.includes(o.id), undefined, true))}
        </View>
      );
      break;
    case 'true_false':
      control = (
        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          {([true, false] as const).map((value) => (
            <Pressable
              key={String(value)}
              testID={value ? 'option-true' : 'option-false'}
              accessibilityRole="button"
              accessibilityState={{ selected: draft.bool === value }}
              disabled={disabled}
              onPress={() => onChange({ ...draft, bool: value })}
              style={{
                flex: 1,
                minHeight: 72,
                borderRadius: theme.radii.md,
                borderWidth: 2,
                borderColor: draft.bool === value ? c.child : c.border,
                backgroundColor: draft.bool === value ? c.warningBg : c.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={[theme.typography.heading, { color: c.text }]}>
                {value ? t('practice.true') : t('practice.false')}
              </Text>
            </Pressable>
          ))}
        </View>
      );
      break;
    case 'numeric':
      control = (
        <Keypad
          value={draft.text}
          disabled={disabled}
          onChange={(text) => onChange({ ...draft, text })}
        />
      );
      break;
    case 'fill_blank':
      control = column(
        draft.blanks.map((value, i) => (
          <TextInput
            key={i}
            testID={`blank-${i}`}
            accessibilityLabel={t('practice.blank', { n: i + 1 })}
            placeholder={t('practice.blank', { n: i + 1 })}
            placeholderTextColor={c.textMuted}
            editable={!disabled}
            autoCapitalize="none"
            autoCorrect={false}
            value={value}
            onChangeText={(text) =>
              onChange({ ...draft, blanks: draft.blanks.map((b, j) => (j === i ? text : b)) })
            }
            style={[
              young ? theme.typography.childBody : theme.typography.body,
              {
                minHeight: theme.touchTarget.child,
                borderRadius: theme.radii.md,
                borderWidth: 2,
                borderColor: c.border,
                backgroundColor: c.surface,
                color: c.text,
                paddingHorizontal: theme.spacing.md,
              },
            ]}
          />
        )),
      );
      break;
    case 'word_bank':
      control = column(
        <>
          <Slots slots={draft.slots} item={item} onTap={tap} disabled={disabled} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {item.options.filter((o) => !draft.slots.includes(o.id)).map((o) => option(o, false))}
          </View>
        </>,
      );
      break;
    case 'ordering':
      control = column(
        <>
          <Text style={[theme.typography.caption, { color: c.textMuted }]}>
            {t('practice.orderHelp')}
          </Text>
          <Slots slots={draft.slots} item={item} onTap={tap} disabled={disabled} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {item.options.filter((o) => !draft.slots.includes(o.id)).map((o) => option(o, false))}
          </View>
        </>,
      );
      break;
    case 'matching': {
      const pairIndex = (id: string) => draft.pairs.findIndex((p) => p.includes(id));
      const side = (which: 'left' | 'right') => (
        <View style={{ flex: 1, gap: theme.spacing.sm }}>
          {item.options
            .filter((o) => o.side === which)
            .map((o) => {
              const i = pairIndex(o.id);
              return option(
                o,
                i !== -1 || draft.pendingLeft === o.id,
                i === -1 ? undefined : `${i + 1}`,
              );
            })}
        </View>
      );
      control = column(
        <>
          <Text style={[theme.typography.caption, { color: c.textMuted }]}>
            {t('practice.matchHelp')}
          </Text>
          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            {side('left')}
            {side('right')}
          </View>
        </>,
      );
      break;
    }
  }

  return (
    <View testID={`item-${item.type}`} style={{ gap: theme.spacing.md }}>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <RichText
            testID="item-stem"
            source={item.stemMd}
            style={young ? theme.typography.childBody : theme.typography.heading}
          />
        </View>
        <SpeakButton testID="speak-item" text={speechFor(item)} lang={item.ttsLang} />
      </View>
      {item.media.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {item.media.map((m) => (
            <Media key={m.id} media={m} size={160} />
          ))}
        </View>
      )}
      {control}
    </View>
  );
}
