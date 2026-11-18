import { Pressable, Text } from 'react-native';
import { t } from '../../i18n/index.ts';
import { speak } from '../../lib/speech.ts';
import { useTheme } from '../../theme.ts';

/** Speaker button: reads `text` aloud on the device. */
export function SpeakButton(props: { text: string; lang: 'vi' | 'en'; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={props.testID ?? 'speak'}
      accessibilityRole="button"
      accessibilityLabel={t('practice.readAloud')}
      onPress={() => speak(props.text, props.lang)}
      style={({ pressed }) => ({
        width: theme.touchTarget.child,
        height: theme.touchTarget.child,
        borderRadius: theme.touchTarget.child / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceMuted,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontSize: 26 }}>🔊</Text>
    </Pressable>
  );
}
