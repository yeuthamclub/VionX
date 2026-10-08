import { colors, radii, spacing, touchTarget, typography } from '@vionx/tokens';
import { useColorScheme } from 'react-native';

export function useTheme() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { scheme, colors: colors[scheme], spacing, radii, typography, touchTarget } as const;
}

export type Theme = ReturnType<typeof useTheme>;
