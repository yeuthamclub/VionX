import type { ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { AppError, describeError } from '../lib/api-error.ts';
import { t } from '../i18n/index.ts';
import { useTheme } from '../theme.ts';
import { Button } from './Button.tsx';
import type { Loadable } from './useLoad.ts';

/** Renders loading / error (offline vs server) / empty / ready for a Loadable. */
export function StateView<T>(props: {
  state: Loadable<T>;
  reload: () => void;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  const theme = useTheme();
  const { state } = props;
  if (state.kind === 'loading') {
    return (
      <View
        testID="state-loading"
        style={{ padding: theme.spacing.xl, alignItems: 'center', gap: 8 }}
      >
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={{ color: theme.colors.textMuted }}>{t('common.loading')}</Text>
      </View>
    );
  }
  if (state.kind === 'error') {
    const offline = state.error instanceof AppError && state.error.kind === 'offline';
    return (
      <View testID={offline ? 'state-offline' : 'state-error'} style={{ gap: theme.spacing.md }}>
        <Text style={[theme.typography.body, { color: theme.colors.danger }]}>
          {describeError(state.error)}
        </Text>
        <Button label={t('common.retry')} variant="secondary" onPress={props.reload} />
      </View>
    );
  }
  if (props.isEmpty?.(state.data)) {
    return (
      <View testID="state-empty" style={{ gap: theme.spacing.md }}>
        {props.empty}
      </View>
    );
  }
  return <>{props.children(state.data)}</>;
}
