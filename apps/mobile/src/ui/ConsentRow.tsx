import type { ConsentState } from '@vionx/contracts/client';
import { Text, View } from 'react-native';
import { t } from '../i18n/index.ts';
import { consentBodyKey, consentStateKey, consentTitleKey, isGrantActive } from '../lib/consent.ts';
import { useTheme } from '../theme.ts';
import { Button } from './Button.tsx';

/** One consent type: what it covers, its state, and a turn on / turn off action. */
export function ConsentRow(props: {
  state: ConsentState;
  busy?: boolean;
  onGrant: () => void;
  onRevoke: () => void;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const { state } = props;
  const active = isGrantActive(state);
  const tone = state.effective ? c.success : active ? c.warning : c.textMuted;
  return (
    <View
      testID={`consent-${state.type}`}
      style={{
        gap: theme.spacing.xs,
        padding: theme.spacing.lg,
        backgroundColor: c.surface,
        borderRadius: theme.radii.lg,
        borderWidth: 1,
        borderColor: c.border,
      }}
    >
      <Text style={[theme.typography.bodyStrong, { color: c.text }]}>
        {t(consentTitleKey(state.type))}
      </Text>
      <Text style={[theme.typography.caption, { color: c.textMuted }]}>
        {t(consentBodyKey(state.type))}
      </Text>
      <Text testID={`consent-state-${state.type}`} style={{ color: tone }}>
        {t(consentStateKey(state))}
      </Text>
      {state.childAssentRequiredNow && (
        <Text style={[theme.typography.caption, { color: c.textMuted }]}>
          {t('consents.assentNote')}
        </Text>
      )}
      <Button
        testID={active ? `revoke-${state.type}` : `grant-${state.type}`}
        label={active ? t('consents.turnOff') : t('consents.turnOn')}
        variant={active ? 'secondary' : 'primary'}
        disabled={props.busy}
        onPress={active ? props.onRevoke : props.onGrant}
      />
    </View>
  );
}
