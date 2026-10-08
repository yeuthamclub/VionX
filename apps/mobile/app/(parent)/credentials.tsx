import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import type { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { t } from '../../src/i18n/index.ts';
import { takeCredentials } from '../../src/state/credentials.ts';
import { Button } from '../../src/ui/Button.tsx';
import { CredentialCard } from '../../src/ui/CredentialCard.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { Screen } from '../../src/ui/Screen.tsx';

/** One-time credential card after creating a child or resetting a PIN; shareable as an image. */
export default function Credentials() {
  const [credentials] = useState(takeCredentials);
  const card = useRef<View>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Opened again after leaving: the PIN is gone by design.
    if (!credentials) router.replace('/parent');
  }, [credentials]);
  if (!credentials) return null;

  const share = async () => {
    setError(null);
    try {
      if (!(await Sharing.isAvailableAsync())) return setError(t('credentials.shareUnavailable'));
      const uri = await captureRef(card, { format: 'png', quality: 1, result: 'tmpfile' });
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle: credentials.displayName,
      });
    } catch {
      setError(t('error.generic'));
    }
  };

  return (
    <Screen
      title={t('credentials.title', { name: credentials.displayName })}
      testID="screen-credentials"
    >
      <CredentialCard
        ref={card}
        displayName={credentials.displayName}
        childLoginId={credentials.childLoginId}
        pin={credentials.pin}
      />
      <Notice tone="info" message={t('credentials.warning')} />
      <Button testID="share-card" label={t('credentials.share')} onPress={() => void share()} />
      <Button
        testID="credentials-done"
        label={t('common.done')}
        variant="secondary"
        onPress={() => router.replace('/parent')}
      />
      <Notice message={error} />
    </Screen>
  );
}
