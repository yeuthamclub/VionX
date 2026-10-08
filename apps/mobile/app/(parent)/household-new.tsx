import { router } from 'expo-router';
import { useState } from 'react';
import { parentApi } from '../../src/api.ts';
import { t } from '../../src/i18n/index.ts';
import { describeError, unwrap } from '../../src/lib/api-error.ts';
import { Button } from '../../src/ui/Button.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { TextField } from '../../src/ui/TextField.tsx';

export default function HouseholdNew() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(parentApi.POST('/api/v1/household', { body: { name: name.trim() } }));
      router.replace('/parent');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title={t('household.title')}
      subtitle={t('household.subtitle')}
      testID="screen-household-new"
    >
      <TextField
        testID="household-name"
        label={t('household.nameLabel')}
        placeholder={t('household.namePlaceholder')}
        maxLength={80}
        value={name}
        onChangeText={setName}
      />
      <Button
        testID="household-create"
        label={t('household.create')}
        busy={busy}
        disabled={!name.trim()}
        onPress={() => void create()}
      />
      <Notice message={error} />
    </Screen>
  );
}
