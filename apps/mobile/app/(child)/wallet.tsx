import { router } from 'expo-router';
import { childApi } from '../../src/api.ts';
import { t } from '../../src/i18n/index.ts';
import { AppError, unwrap } from '../../src/lib/api-error.ts';
import { childToken } from '../../src/state/device.ts';
import { useTheme } from '../../src/theme.ts';
import { Button } from '../../src/ui/Button.tsx';
import { LedgerList } from '../../src/ui/LedgerList.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { StateView } from '../../src/ui/StateView.tsx';
import { useLoad } from '../../src/ui/useLoad.ts';
import { WalletCard } from '../../src/ui/WalletCard.tsx';

/** Child: wallet — XP, level, Coin, today's cap bar — the way to the rewards, and the history. */
export default function ChildWallet() {
  const theme = useTheme();
  const { state, reload } = useLoad(async () => {
    try {
      const session = await unwrap(childApi.GET('/api/v1/auth/child/session'));
      const id = session.student.id;
      const wallet = await unwrap(
        childApi.GET('/api/v1/students/{id}/rewards/wallet', { params: { path: { id } } }),
      );
      return { id, wallet };
    } catch (e) {
      if (e instanceof AppError && e.status === 401) {
        await childToken.clear();
        router.replace('/child');
      }
      throw e;
    }
  });
  return (
    <Screen title={t('wallet.title')} testID="screen-child-wallet">
      <StateView state={state} reload={reload}>
        {({ id, wallet }) => (
          <>
            <WalletCard wallet={wallet} mode="child" />
            <Button
              testID="open-child-rewards"
              label={t('wallet.openCatalog')}
              color={theme.colors.child}
              onPress={() => router.push('/rewards')}
            />
            <LedgerList
              load={(kind, cursor) =>
                unwrap(
                  childApi.GET('/api/v1/students/{id}/rewards/ledger', {
                    params: {
                      path: { id },
                      query: { kind, limit: 30, ...(cursor ? { cursor } : {}) },
                    },
                  }),
                )
              }
            />
          </>
        )}
      </StateView>
    </Screen>
  );
}
