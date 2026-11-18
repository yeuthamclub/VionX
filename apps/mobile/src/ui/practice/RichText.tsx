import katex from 'katex';
import { useState } from 'react';
import { Text, View, type TextStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { hasMath, splitMath } from '../../lib/practice.ts';
import { useTheme } from '../../theme.ts';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const bold = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

/** HTML of a stem: text escaped, TeX rendered by KaTeX to MathML (no KaTeX CSS or fonts needed). */
export function mathHtml(source: string, color: string, fontSize: number): string {
  const body = splitMath(source)
    .map((p) =>
      p.math
        ? katex.renderToString(p.text, { output: 'mathml', throwOnError: false, trust: false })
        : bold(escapeHtml(p.text)).replace(/\n/g, '<br/>'),
    )
    .join('');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>body{margin:0;padding:0;background:transparent;color:${color};font:${fontSize}px/1.5 sans-serif}math{font-size:1.1em}</style></head>
<body><div id="c">${body}</div></body></html>`;
}

const REPORT_HEIGHT =
  'window.ReactNativeWebView.postMessage(String(document.getElementById("c").offsetHeight));true;';

/**
 * Stem, option or hint text. Plain text renders as `Text`; text with `$…$` goes through KaTeX
 * (MathML) in a WebView that sizes itself and lets touches through to the button around it.
 */
export function RichText(props: { source: string; style?: TextStyle; testID?: string }) {
  const theme = useTheme();
  const fontSize = props.style?.fontSize ?? theme.typography.body.fontSize;
  const color = (props.style?.color as string | undefined) ?? theme.colors.text;
  const [height, setHeight] = useState(fontSize * 2);
  if (!hasMath(props.source)) {
    return (
      <Text testID={props.testID} style={[theme.typography.body, { color }, props.style]}>
        {props.source.replace(/\*\*(.+?)\*\*/g, '$1')}
      </Text>
    );
  }
  return (
    <View testID={props.testID} pointerEvents="none" style={{ height, alignSelf: 'stretch' }}>
      <WebView
        originWhitelist={['about:blank']}
        source={{ html: mathHtml(props.source, color, fontSize) }}
        injectedJavaScript={REPORT_HEIGHT}
        onMessage={(e) => setHeight(Math.max(fontSize * 1.5, Number(e.nativeEvent.data) || 0))}
        scrollEnabled={false}
        javaScriptEnabled
        style={{ backgroundColor: 'transparent' }}
      />
    </View>
  );
}
