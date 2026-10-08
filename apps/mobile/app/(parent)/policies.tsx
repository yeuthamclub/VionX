import type { PoliciesResponse, PolicyType } from '@vionx/contracts/client';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { parentApi } from '../../src/api.ts';
import { getLocale, t, type MessageKey } from '../../src/i18n/index.ts';
import { AppError, describeError, unwrap } from '../../src/lib/api-error.ts';
import { getDeviceId } from '../../src/state/device.ts';
import { useTheme } from '../../src/theme.ts';
import { Button } from '../../src/ui/Button.tsx';
import { MarkdownText } from '../../src/ui/MarkdownText.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { StateView } from '../../src/ui/StateView.tsx';
import { useLoad } from '../../src/ui/useLoad.ts';

const POINTS: MessageKey[] = [
  'policies.point.storage',
  'policies.point.ai',
  'policies.point.speech',
  'policies.point.control',
];

/**
 * Parent onboarding consent step: key disclosures (Singapore hosting, AI by Anthropic, speech on
 * the device), the full privacy policy and terms, and acceptance of the current versions.
 * `?view=1` opens it read-only from the Privacy Center.
 */
export default function Policies() {
  const theme = useTheme();
  const c = theme.colors;
  const { view } = useLocalSearchParams<{ view?: string }>();
  const readOnly = view === '1';
  const { state, reload } = useLoad(() =>
    unwrap(
      parentApi.GET('/api/v1/policies/current', { params: { query: { locale: getLocale() } } }),
    ),
  );
  const [open, setOpen] = useState<PolicyType | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async (data: PoliciesResponse) => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(
        parentApi.POST('/api/v1/policies/accept', {
          body: {
            policies: data.policies.map((p) => ({ type: p.type, version: p.version })),
            locale: getLocale(),
            deviceId: await getDeviceId(),
          },
        }),
      );
      const me = await unwrap(parentApi.GET('/api/v1/me'));
      router.replace(me.households.length > 0 ? '/parent' : '/household-new');
    } catch (e) {
      if (e instanceof AppError && e.code === 'CONFLICT') {
        setError(t('error.policyChanged'));
        reload();
      } else {
        setError(describeError(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('policies.title')} subtitle={t('policies.subtitle')} testID="screen-policies">
      <StateView state={state} reload={reload}>
        {(data) => (
          <View style={{ gap: theme.spacing.lg }}>
            <View style={{ gap: theme.spacing.sm }}>
              {POINTS.map((key) => (
                <Text key={key} style={[theme.typography.body, { color: c.text }]}>
                  • {t(key)}
                </Text>
              ))}
            </View>
            {data.policies.map((p) => (
              <View
                key={p.type}
                style={{
                  gap: theme.spacing.sm,
                  padding: theme.spacing.lg,
                  backgroundColor: c.surface,
                  borderRadius: theme.radii.lg,
                  borderWidth: 1,
                  borderColor: c.border,
                }}
              >
                <Text style={[theme.typography.bodyStrong, { color: c.text }]}>
                  {t(`policyType.${p.type}` as MessageKey)}
                </Text>
                <Text style={[theme.typography.caption, { color: c.textMuted }]}>
                  {t('policies.version', { v: p.version })}
                </Text>
                <Pressable
                  testID={`policy-toggle-${p.type}`}
                  accessibilityRole="button"
                  onPress={() => setOpen(open === p.type ? null : p.type)}
                >
                  <Text style={{ color: c.primary }}>
                    {open === p.type ? t('policies.hide') : t('policies.read')}
                  </Text>
                </Pressable>
                {open === p.type && <MarkdownText source={p.contentMd} />}
              </View>
            ))}
            {!readOnly && (
              <>
                <Pressable
                  testID="policies-agree"
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: agreed }}
                  onPress={() => setAgreed(!agreed)}
                  style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 24, color: c.primary }}>{agreed ? '☑' : '☐'}</Text>
                  <Text style={[theme.typography.body, { color: c.text, flex: 1 }]}>
                    {t('policies.agree')}
                  </Text>
                </Pressable>
                <Button
                  testID="policies-accept"
                  label={t('policies.continue')}
                  busy={busy}
                  disabled={!agreed}
                  onPress={() => void accept(data)}
                />
              </>
            )}
          </View>
        )}
      </StateView>
      <Notice message={error} />
    </Screen>
  );
}
