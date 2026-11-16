import type { PracticeMedia } from '@vionx/contracts/client';
import { Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useTheme } from '../../theme.ts';

/** Library picture: sanitised inline SVG; other kinds show their description until M09 adds files. */
export function Media({ media, size = 120 }: { media: PracticeMedia; size?: number }) {
  const theme = useTheme();
  if (media.svg) {
    return (
      <View accessible accessibilityRole="image" accessibilityLabel={media.alt}>
        <SvgXml xml={media.svg} width={size} height={size} />
      </View>
    );
  }
  return (
    <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{media.alt}</Text>
  );
}
