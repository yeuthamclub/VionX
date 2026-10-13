import type { CatalogItem } from '@vionx/contracts/client';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { childApi } from '../../src/api.ts';
import { t, type MessageKey } from '../../src/i18n/index.ts';
import { AppError, describeError, unwrap } from '../../src/lib/api-error.ts';
import { childToken } from '../../src/state/device.ts';
import { useTheme } from '../../src/theme.ts';
import { Button } from '../../src/ui/Button.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { StateView } from '../../src/ui/StateView.tsx';
import { useLoad } from '../../src/ui/useLoad.ts';
import { CATALOG_GLYPHS } from '../../src/ui/WalletCard.tsx';

/**
 * Child: the family's rewards and the child's requests. "Redeem" sends a request to the parents
 * (the Coin is held at once). Each request keeps its clientUuid until the server answers, so a retry
 * after a lost response is recorded once.
 */
export default function ChildRewards() {
  const theme = useTheme();
  const c = theme.colors;
  const { state, reload } = useLoad(async () => {
    try {
      const session = await unwrap(childApi.GET('/api/v1/auth/child/session'));
      const id = session.student.id;
      const [catalog, wallet, requests] = await Promise.all([
        unwrap(childApi.GET('/api/v1/household/reward-catalog')),
        unwrap(childApi.GET('/api/v1/students/{id}/rewards/wallet', { params: { path: { id } } })),
        unwrap(childApi.GET('/api/v1/reward-redemptions')),
      ]);
      return { catalog, balance: wallet.coinBalance, requests: requests.items };
    } catch (e) {
      if (e instanceof AppError && e.status === 401) {
        await childToken.clear();
        router.replace('/child');
      }
      throw e;
    }
  });
  const pending = useRef(new Map<string, string>());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);

  const redeem = async (item: CatalogItem) => {
    setBusyId(item.id);
    setMessage(null);
    const clientUuid = pending.current.get(item.id) ?? Crypto.randomUUID();
    pending.current.set(item.id, clientUuid);
    try {
      await unwrap(
        childApi.POST('/api/v1/reward-redemptions', { body: { clientUuid, itemId: item.id } }),
      );
      pending.current.delete(item.id);
      setMessage({ text: t('catalog.redeemed'), tone: 'info' });
      reload();
    } catch (e) {
      if (!(e instanceof AppError && e.kind === 'offline')) pending.current.delete(item.id);
      setMessage({ text: describeError(e), tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen title={t('catalog.childTitle')} testID="screen-child-rewards">
      {message && (
        <Notice message={message.text} tone={message.tone} testID="child-rewards-message" />
      )}
      <StateView
        state={state}
        reload={reload}
        isEmpty={(d) => d.catalog.items.length === 0 && d.requests.length === 0}
        empty={
          <Text
            testID="child-rewards-empty"
            style={[theme.typography.childBody, { color: c.textMuted }]}
          >
            {t('catalog.empty')}
          </Text>
        }
      >
        {(d) => (
          <View style={{ gap: theme.spacing.md }}>
            <Text
              testID="child-rewards-balance"
              style={[theme.typography.heading, { color: c.reward }]}
            >
              {t('catalog.balance', { n: d.balance })}
            </Text>
            {d.catalog.items.map((item) => {
              const missing = item.costCoins - d.balance;
              return (
                <View
                  key={item.id}
                  testID={`reward-${item.id}`}
                  style={{
                    gap: theme.spacing.sm,
                    padding: theme.spacing.lg,
                    backgroundColor: c.surface,
                    borderRadius: theme.radii.lg,
                    borderWidth: 1,
                    borderColor: c.border,
                  }}
                >
                  <Text style={[theme.typography.childBody, { color: c.text }]}>
                    {CATALOG_GLYPHS[item.icon]} {item.title}
                  </Text>
                  {item.description && (
                    <Text style={{ color: c.textMuted }}>{item.description}</Text>
                  )}
                  <Text style={{ color: c.reward }}>
                    {t('wallet.coins', { n: item.costCoins })}
                  </Text>
                  {missing > 0 ? (
                    <Text style={{ color: c.textMuted }}>
                      {t('catalog.notEnough', { n: missing })}
                    </Text>
                  ) : (
                    <Button
                      testID={`redeem-${item.id}`}
                      label={t('catalog.redeem')}
                      color={c.child}
                      busy={busyId === item.id}
                      onPress={() => void redeem(item)}
                    />
                  )}
                </View>
              );
            })}
            {d.requests.length > 0 && (
              <View style={{ gap: theme.spacing.sm }}>
                <Text style={[theme.typography.heading, { color: c.text }]}>
                  {t('catalog.myRequests')}
                </Text>
                {d.requests.map((r) => (
                  <Text key={r.id} testID={`my-request-${r.id}`} style={{ color: c.text }}>
                    {r.title} · {t(`redemptions.status.${r.status}` as MessageKey)}
                    {r.decisionNote ? ` · ${r.decisionNote}` : ''}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}
      </StateView>
    </Screen>
  );
}
