import type { LedgerEntry, LedgerResponse } from '@vionx/contracts/client';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { t } from '../i18n/index.ts';
import { describeError } from '../lib/api-error.ts';
import { ledgerLine } from '../lib/rewards.ts';
import { useTheme } from '../theme.ts';
import { Button } from './Button.tsx';
import { Chip, ChipRow } from './Chip.tsx';
import { Notice } from './Notice.tsx';

type Kind = 'coin' | 'xp';

/** Coin / XP ledger with a kind switch and "show more" (cursor pagination). */
export function LedgerList(props: {
  load: (kind: Kind, cursor: string | null) => Promise<LedgerResponse>;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const [kind, setKind] = useState<Kind>('coin');
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { load } = props;

  const fetchPage = async (k: Kind, from: string | null, append: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const page = await load(k, from);
      setEntries((prev) => (append ? [...prev, ...page.entries] : page.entries));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void fetchPage(kind, null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  return (
    <View style={{ gap: theme.spacing.md }} testID="ledger">
      <Text style={[theme.typography.heading, { color: c.text }]}>{t('ledger.title')}</Text>
      <ChipRow>
        <Chip
          testID="ledger-coin"
          label={t('ledger.coins')}
          selected={kind === 'coin'}
          onPress={() => setKind('coin')}
        />
        <Chip
          testID="ledger-xp"
          label={t('ledger.xp')}
          selected={kind === 'xp'}
          onPress={() => setKind('xp')}
        />
      </ChipRow>
      {error && <Notice message={error} testID="ledger-error" />}
      {!busy && !error && entries.length === 0 && (
        <Text testID="ledger-empty" style={{ color: c.textMuted }}>
          {t('ledger.empty')}
        </Text>
      )}
      {entries.map((e) => {
        const line = ledgerLine(e);
        return (
          <View
            key={e.id}
            testID={`ledger-entry-${e.id}`}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
              borderBottomWidth: 1,
              borderBottomColor: c.border,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: c.text }}>{line.title}</Text>
              <Text style={[theme.typography.caption, { color: c.textMuted }]}>
                {new Date(e.createdAt).toLocaleString('vi-VN')}
                {line.detail ? ` · ${line.detail}` : ''}
              </Text>
            </View>
            <Text
              style={[
                theme.typography.bodyStrong,
                { color: line.amount.startsWith('−') ? c.danger : c.success },
              ]}
            >
              {line.amount}
            </Text>
          </View>
        );
      })}
      {(cursor || busy) && (
        <Button
          testID="ledger-more"
          label={t('ledger.more')}
          variant="secondary"
          busy={busy}
          onPress={() => void fetchPage(kind, cursor, true)}
        />
      )}
    </View>
  );
}
