import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { parentApi } from '../../../src/api.ts';
import { t } from '../../../src/i18n/index.ts';
import { unwrap } from '../../../src/lib/api-error.ts';
import { useTheme } from '../../../src/theme.ts';
import { Button } from '../../../src/ui/Button.tsx';
import { LedgerList } from '../../../src/ui/LedgerList.tsx';
import { Screen } from '../../../src/ui/Screen.tsx';
import { StateView } from '../../../src/ui/StateView.tsx';
import { useLoad } from '../../../src/ui/useLoad.ts';
import { WalletCard } from '../../../src/ui/WalletCard.tsx';

/** Parent: a child's rewards — wallet (XP, level, Coin, today's cap bar) and the ledgers. */
export default function ChildRewards() {
  const theme = useTheme();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { state, reload } = useLoad(
    () =>
      unwrap(parentApi.GET('/api/v1/students/{id}/rewards/wallet', { params: { path: { id } } })),
    [id],
  );
  return (
    <Screen title={t('student.rewards')} subtitle={name} testID="screen-parent-rewards">
      <StateView state={state} reload={reload}>
        {(wallet) => <WalletCard wallet={wallet} mode="parent" />}
      </StateView>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            testID="open-reward-rules"
            label={t('rules.open')}
            variant="secondary"
            onPress={() => router.push('/reward-rules')}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            testID="open-reward-catalog"
            label={t('catalog.open')}
            variant="secondary"
            onPress={() => router.push('/reward-catalog')}
          />
        </View>
      </View>
      <LedgerList
        load={(kind, cursor) =>
          unwrap(
            parentApi.GET('/api/v1/students/{id}/rewards/ledger', {
              params: { path: { id }, query: { kind, limit: 30, ...(cursor ? { cursor } : {}) } },
            }),
          )
        }
      />
    </Screen>
  );
}
