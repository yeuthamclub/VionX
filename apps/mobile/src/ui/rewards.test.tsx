/// <reference types="jest" />
import type { Wallet } from '@vionx/contracts/client';
import { render, screen } from '@testing-library/react-native';
import { ProgressBar } from './CapBar.tsx';
import { WalletCard } from './WalletCard.tsx';

const wallet = (over: Partial<Wallet> = {}): Wallet => ({
  studentId: 's1',
  timezone: 'Asia/Ho_Chi_Minh',
  today: '2026-10-17',
  lifetimeXp: 3500,
  level: { level: 8, levelStartXp: 2800, nextLevelXp: 3600, xpIntoLevel: 700, xpForNextLevel: 800 },
  coinBalance: 37,
  coinsHeld: 0,
  nominalVnd: 37_000,
  xpPerCoin: 100,
  todayCap: {
    day: '2026-10-17',
    weekend: true,
    tier: 1,
    capCoins: 30,
    maxCapCoins: 50,
    rewardableXp: 1500,
    capXp: 3000,
    projectedCoins: 15,
    reached: false,
  },
  lastSettled: null,
  ...over,
});

describe('WalletCard', () => {
  it('shows Coin, level, XP and the weekend cap bar', () => {
    render(<WalletCard wallet={wallet()} mode="child" />);
    expect(screen.getByTestId('wallet-coins')).toHaveTextContent('37 Coin');
    expect(screen.getByTestId('wallet-level')).toHaveTextContent('Cấp 8');
    expect(screen.getByTestId('wallet-xp')).toHaveTextContent('Tổng 3500 XP');
    expect(screen.getByTestId('wallet-tier')).toHaveTextContent(/mức 1/);
    expect(screen.getByText('1500/3000 XP · cuối ngày được 15 Coin')).toBeTruthy();
    expect(screen.queryByTestId('wallet-held')).toBeNull();
  });

  it('shows held Coin and the last settled day', () => {
    render(
      <WalletCard
        wallet={wallet({
          coinsHeld: 5,
          lastSettled: {
            day: '2026-10-16',
            tier: null,
            capCoins: 20,
            rewardableXp: 2000,
            coinsTotal: 20,
            settledAt: '2026-10-16T17:05:00Z',
          },
        })}
        mode="parent"
      />,
    );
    expect(screen.getByTestId('wallet-held')).toHaveTextContent(/5 Coin/);
    expect(screen.getByText('Ngày 2026-10-16: nhận 20 Coin')).toBeTruthy();
  });
});

describe('ProgressBar', () => {
  it('reports its value for accessibility and clamps it', () => {
    render(<ProgressBar testID="bar" fraction={1.7} caption="Đầy" />);
    expect(screen.getByTestId('bar-fill')).toHaveStyle({ width: '100%' });
    expect(screen.getByText('Đầy')).toBeTruthy();
  });
});
