import { AVATARS, DEFAULT_AVATAR, MAX_GRADE, MIN_GRADE, PIN_PATTERN } from '@vionx/domain';
import type { Avatar } from '@vionx/contracts/client';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { parentApi } from '../../src/api.ts';
import { t, type MessageKey } from '../../src/i18n/index.ts';
import { describeError, unwrap } from '../../src/lib/api-error.ts';
import { holdCredentials } from '../../src/state/credentials.ts';
import { useTheme } from '../../src/theme.ts';
import { AVATAR_GLYPHS } from '../../src/ui/avatars.ts';
import { Button } from '../../src/ui/Button.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { TextField } from '../../src/ui/TextField.tsx';

const GRADES = Array.from({ length: MAX_GRADE - MIN_GRADE + 1 }, (_, i) => MIN_GRADE + i);

export default function ChildNew() {
  const theme = useTheme();
  const c = theme.colors;
  const [displayName, setDisplayName] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [grade, setGrade] = useState<number | null>(null);
  const [avatar, setAvatar] = useState<Avatar>(DEFAULT_AVATAR);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const year = Number(birthYear);
  const pinOk = pin === '' || PIN_PATTERN.test(pin);
  const valid =
    displayName.trim().length > 0 && /^\d{4}$/.test(birthYear) && grade !== null && pinOk;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await unwrap(
        parentApi.POST('/api/v1/students', {
          body: {
            displayName: displayName.trim(),
            birthYear: year,
            grade: grade!,
            avatar,
            ...(pin ? { pin } : {}),
          },
        }),
      );
      holdCredentials({ ...res.credentials, displayName: res.student.displayName });
      router.replace('/credentials');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const Chip = (props: {
    label: string;
    selected: boolean;
    onPress: () => void;
    testID: string;
  }) => (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      style={{
        minWidth: theme.touchTarget.default,
        minHeight: theme.touchTarget.default,
        paddingHorizontal: theme.spacing.md,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radii.pill,
        borderWidth: 1,
        borderColor: props.selected ? c.parent : c.border,
        backgroundColor: props.selected ? c.surfaceMuted : c.surface,
      }}
    >
      <Text style={{ color: c.text, fontSize: 18 }}>{props.label}</Text>
    </Pressable>
  );

  return (
    <Screen title={t('childNew.title')} testID="screen-child-new">
      <TextField
        testID="child-name"
        label={t('childNew.name')}
        maxLength={40}
        value={displayName}
        onChangeText={setDisplayName}
      />
      <TextField
        testID="child-birth-year"
        label={t('childNew.birthYear')}
        keyboardType="number-pad"
        maxLength={4}
        value={birthYear}
        onChangeText={setBirthYear}
      />
      <Text style={[theme.typography.caption, { color: c.textMuted }]}>{t('childNew.grade')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {GRADES.map((g) => (
          <Chip
            key={g}
            testID={`grade-${g}`}
            label={String(g)}
            selected={grade === g}
            onPress={() => setGrade(g)}
          />
        ))}
      </View>
      <Text style={[theme.typography.caption, { color: c.textMuted }]}>{t('childNew.avatar')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {AVATARS.map((a) => (
          <Chip
            key={a}
            testID={`avatar-${a}`}
            label={AVATAR_GLYPHS[a]}
            selected={avatar === a}
            onPress={() => setAvatar(a)}
          />
        ))}
      </View>
      <Text style={[theme.typography.caption, { color: c.textMuted }]}>
        {t(`avatar.${avatar}` as MessageKey)}
      </Text>
      <TextField
        testID="child-pin"
        label={t('childNew.pin')}
        keyboardType="number-pad"
        maxLength={8}
        secureTextEntry
        value={pin}
        onChangeText={setPin}
        error={pinOk ? null : t('error.validation')}
      />
      <Button
        testID="child-create"
        label={t('childNew.create')}
        busy={busy}
        disabled={!valid}
        onPress={() => void create()}
      />
      <Notice message={error} />
    </Screen>
  );
}
