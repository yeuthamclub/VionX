import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { startRoute } from '../src/state/session.ts';
import { useTheme } from '../src/theme.ts';

/** Bootstrap: child-device mode, a valid child session or a parent session decide the first screen. */
export default function Index() {
  const theme = useTheme();
  useEffect(() => {
    void startRoute().then((route) => router.replace(route));
  }, []);
  return (
    <View
      testID="bootstrap"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.background,
      }}
    >
      <ActivityIndicator color={theme.colors.primary} />
    </View>
  );
}
