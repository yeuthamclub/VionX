import type { Wallet } from '@vionx/contracts/client';
import { Text, View } from 'react-native';
import { t } from '../i18n/index.ts';
import { capBar, formatVnd, levelFraction } from '../lib/rewards.ts';
import { useTheme } from '../theme.ts';
import { ProgressBar } from './CapBar.tsx';

/** XP, level, Coin and today's cap bar (child wallet and the parent's rewards screen). */
export function WalletCard(props: { wallet: Wallet; mode: 'child' | 'parent' }) {
  const theme = useTheme();
  const c = theme.colors;
  const w = props.wallet;
  const bar = capBar(w.todayCap);
  const body = props.mode === 'child' ? theme.typography.childBody : theme.typography.body;
  return (
    <View
      testID="wallet-card"
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        backgroundColor: c.surface,
        borderRadius: theme.radii.lg,
        borderWidth: 1,
        borderColor: c.border,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text testID="wallet-coins" style={[theme.typography.title, { color: c.reward }]}>
            {t('wallet.coins', { n: w.coinBalance })}
          </Text>
          <Text style={[theme.typography.caption, { color: c.textMuted }]}>
            {t('wallet.coinsValue', { vnd: formatVnd(w.nominalVnd) })}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: theme.spacing.xs }}>
          <Text testID="wallet-level" style={[theme.typography.heading, { color: c.text }]}>
            {t('wallet.level', { n: w.level.level })}
          </Text>
          <Text testID="wallet-xp" style={[theme.typography.caption, { color: c.textMuted }]}>
            {t('wallet.lifetimeXp', { n: w.lifetimeXp })}
          </Text>
        </View>
      </View>
      <ProgressBar
        testID="wallet-level-bar"
        fraction={levelFraction(w.level)}
        color={c.primary}
        caption={t('wallet.levelProgress', {
          xp: w.level.xpIntoLevel,
          next: w.level.xpForNextLevel,
          n: w.level.level + 1,
        })}
      />
      {w.coinsHeld > 0 && (
        <Text testID="wallet-held" style={[body, { color: c.warning }]}>
          {t('wallet.held', { n: w.coinsHeld })}
        </Text>
      )}
      <View style={{ gap: theme.spacing.xs }}>
        <Text style={[theme.typography.bodyStrong, { color: c.text }]}>{t('wallet.today')}</Text>
        {bar.tierLine && (
          <Text testID="wallet-tier" style={[theme.typography.caption, { color: c.textMuted }]}>
            {bar.tierLine}
          </Text>
        )}
        <ProgressBar
          testID="wallet-cap-bar"
          fraction={bar.fraction}
          caption={bar.caption}
          color={w.todayCap.reached ? c.success : c.reward}
        />
      </View>
      {w.lastSettled && (
        <Text style={[theme.typography.caption, { color: c.textMuted }]}>
          {t('wallet.lastSettled', { day: w.lastSettled.day, coins: w.lastSettled.coinsTotal })}
        </Text>
      )}
      <Text style={[theme.typography.caption, { color: c.textMuted }]}>{t('wallet.note')}</Text>
    </View>
  );
}

/** Glyphs for catalog icons. */
export const CATALOG_GLYPHS: Record<string, string> = {
  gift: '🎁',
  screen: '📺',
  game: '🎮',
  book: '📚',
  outing: '🏞️',
  food: '🍦',
  toy: '🧸',
  star: '⭐',
};
