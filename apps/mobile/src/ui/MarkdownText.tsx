import { Text, View } from 'react-native';
import { useTheme } from '../theme.ts';

/**
 * Minimal Markdown for policy texts: headings, quotes, bullets, table rows and paragraphs, with
 * `**bold**` and `code` markers removed. Enough for the legal documents; not a general renderer.
 */
export function MarkdownText({ source, testID }: { source: string; testID?: string }) {
  const theme = useTheme();
  const c = theme.colors;
  const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
  const blocks = source.split('\n').filter((line) => !/^\s*\|?\s*-{3}/.test(line));
  return (
    <View testID={testID} style={{ gap: theme.spacing.sm }}>
      {blocks.map((line, i) => {
        const heading = /^(#{1,3})\s+(.*)$/.exec(line);
        if (heading) {
          return (
            <Text
              key={i}
              style={[
                heading[1]!.length === 1 ? theme.typography.heading : theme.typography.bodyStrong,
                { color: c.text },
              ]}
            >
              {clean(heading[2]!)}
            </Text>
          );
        }
        if (line.trim() === '') return null;
        const text = line.startsWith('> ')
          ? line.slice(2)
          : line.startsWith('- ')
            ? `•  ${line.slice(2)}`
            : line.startsWith('|')
              ? line
                  .split('|')
                  .map((cell) => cell.trim())
                  .filter(Boolean)
                  .join(': ')
              : line;
        return (
          <Text key={i} style={[theme.typography.body, { color: c.text }]}>
            {clean(text)}
          </Text>
        );
      })}
    </View>
  );
}
