import type { CatalogIcon, CatalogItem } from '@vionx/contracts/client';
import { CATALOG_ICONS, MAX_CATALOG_COST_COINS } from '@vionx/domain';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { parentApi } from '../../src/api.ts';
import { t } from '../../src/i18n/index.ts';
import { describeError, unwrap } from '../../src/lib/api-error.ts';
import { formatVnd } from '../../src/lib/rewards.ts';
import { useTheme } from '../../src/theme.ts';
import { Button } from '../../src/ui/Button.tsx';
import { Chip, ChipRow } from '../../src/ui/Chip.tsx';
import { Notice } from '../../src/ui/Notice.tsx';
import { Screen } from '../../src/ui/Screen.tsx';
import { StateView } from '../../src/ui/StateView.tsx';
import { TextField } from '../../src/ui/TextField.tsx';
import { useLoad } from '../../src/ui/useLoad.ts';
import { CATALOG_GLYPHS } from '../../src/ui/WalletCard.tsx';

interface Draft {
  id: string | null;
  title: string;
  description: string;
  cost: string;
  icon: CatalogIcon;
}

const EMPTY: Draft = { id: null, title: '', description: '', cost: '', icon: 'gift' };

/** Parent: the household's reward catalog — add, edit, hide (archive) and show again. */
export default function RewardCatalog() {
  const theme = useTheme();
  const c = theme.colors;
  const { state, reload } = useLoad(() =>
    unwrap(
      parentApi.GET('/api/v1/household/reward-catalog', {
        params: { query: { includeArchived: 'true' } },
      }),
    ),
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);

  const cost = Number(draft?.cost);
  const costOk = Number.isInteger(cost) && cost >= 1 && cost <= MAX_CATALOG_COST_COINS;
  const titleOk = (draft?.title.trim().length ?? 0) > 0;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setDraft(null);
      reload();
    } catch (e) {
      setMessage({ text: describeError(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const save = (d: Draft) =>
    run(() => {
      const body = {
        title: d.title.trim(),
        description: d.description.trim() || null,
        costCoins: cost,
        icon: d.icon,
      };
      return unwrap(
        d.id
          ? parentApi.PATCH('/api/v1/household/reward-catalog/{itemId}', {
              params: { path: { itemId: d.id } },
              body,
            })
          : parentApi.POST('/api/v1/household/reward-catalog', { body }),
      );
    });

  const setArchived = (item: CatalogItem, archived: boolean) =>
    run(() =>
      unwrap(
        parentApi.PATCH('/api/v1/household/reward-catalog/{itemId}', {
          params: { path: { itemId: item.id } },
          body: { archived },
        }),
      ),
    );

  return (
    <Screen title={t('catalog.title')} testID="screen-reward-catalog">
      {message && <Notice message={message.text} tone={message.tone} testID="catalog-message" />}
      {draft ? (
        <View style={{ gap: theme.spacing.md }}>
          <TextField
            testID="catalog-title"
            label={t('catalog.itemTitle')}
            maxLength={80}
            value={draft.title}
            onChangeText={(title) => setDraft({ ...draft, title })}
          />
          <TextField
            testID="catalog-description"
            label={t('catalog.description')}
            maxLength={300}
            value={draft.description}
            onChangeText={(description) => setDraft({ ...draft, description })}
          />
          <TextField
            testID="catalog-cost"
            label={t('catalog.cost')}
            keyboardType="number-pad"
            maxLength={5}
            value={draft.cost}
            onChangeText={(v) => setDraft({ ...draft, cost: v })}
            error={draft.cost === '' || costOk ? null : t('catalog.costInvalid')}
          />
          <ChipRow>
            {CATALOG_ICONS.map((icon) => (
              <Chip
                key={icon}
                testID={`catalog-icon-${icon}`}
                label={CATALOG_GLYPHS[icon] ?? icon}
                selected={draft.icon === icon}
                onPress={() => setDraft({ ...draft, icon })}
              />
            ))}
          </ChipRow>
          <Button
            testID="catalog-save"
            label={t('catalog.save')}
            busy={busy}
            disabled={!costOk || !titleOk}
            onPress={() => void save(draft)}
          />
          <Button label={t('common.cancel')} variant="secondary" onPress={() => setDraft(null)} />
        </View>
      ) : (
        <Button
          testID="catalog-add"
          label={t('catalog.add')}
          color={c.parent}
          onPress={() => setDraft(EMPTY)}
        />
      )}
      <StateView
        state={state}
        reload={reload}
        isEmpty={(data) => data.items.length === 0}
        empty={
          <Text testID="catalog-empty" style={{ color: c.textMuted }}>
            {t('catalog.empty')}
          </Text>
        }
      >
        {(data) => (
          <View style={{ gap: theme.spacing.md }}>
            {data.items.map((item) => (
              <View
                key={item.id}
                testID={`catalog-item-${item.id}`}
                style={{
                  gap: theme.spacing.sm,
                  padding: theme.spacing.lg,
                  backgroundColor: c.surface,
                  borderRadius: theme.radii.lg,
                  borderWidth: 1,
                  borderColor: c.border,
                  opacity: item.status === 'ARCHIVED' ? 0.6 : 1,
                }}
              >
                <Text style={[theme.typography.bodyStrong, { color: c.text }]}>
                  {CATALOG_GLYPHS[item.icon]} {item.title}
                  {item.status === 'ARCHIVED' ? ` · ${t('catalog.archived')}` : ''}
                </Text>
                {item.description && <Text style={{ color: c.textMuted }}>{item.description}</Text>}
                <Text style={{ color: c.reward }}>
                  {t('catalog.costLine', {
                    n: item.costCoins,
                    vnd: formatVnd(item.costCoins * data.coinNominalVnd),
                  })}
                </Text>
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={t('catalog.edit')}
                      variant="secondary"
                      disabled={busy}
                      onPress={() =>
                        setDraft({
                          id: item.id,
                          title: item.title,
                          description: item.description ?? '',
                          cost: String(item.costCoins),
                          icon: item.icon,
                        })
                      }
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={
                        item.status === 'ARCHIVED' ? t('catalog.restore') : t('catalog.archive')
                      }
                      variant="secondary"
                      disabled={busy}
                      onPress={() => void setArchived(item, item.status !== 'ARCHIVED')}
                    />
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </StateView>
    </Screen>
  );
}
