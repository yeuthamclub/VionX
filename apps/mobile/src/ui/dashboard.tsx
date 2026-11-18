// Parent dashboard pieces (M08): the data-sufficiency badge every interpretive figure carries, the
// grade trend chart, the child card of the parent home and a labelled figure.
import type {
  ChildOverview,
  DashboardSchoolSubject,
  DataSufficiency,
} from '@vionx/contracts/client';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { t } from '../i18n/index.ts';
import { chartPoints, overviewLines, sufficiencyLabel } from '../lib/dashboard.ts';
import { useTheme } from '../theme.ts';
import { AVATAR_GLYPHS } from './avatars.ts';

/** How much data a figure stands on (Master Spec §7). */
export function SufficiencyBadge(props: { level: DataSufficiency; testID?: string }) {
  const theme = useTheme();
  const c = theme.colors;
  const color = props.level === 'OK' ? c.success : props.level === 'LOW' ? c.warning : c.textMuted;
  return (
    <Text
      testID={props.testID}
      accessibilityLabel={sufficiencyLabel(props.level)}
      style={[
        theme.typography.caption,
        {
          color,
          borderColor: color,
          borderWidth: 1,
          borderRadius: theme.radii.md,
          paddingHorizontal: theme.spacing.sm,
          alignSelf: 'flex-start',
        },
      ]}
    >
      {sufficiencyLabel(props.level)}
    </Text>
  );
}

/** One number with its caption. */
export function Figure(props: { label: string; value: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 96 }}>
      <Text testID={props.testID} style={[theme.typography.heading, { color: theme.colors.text }]}>
        {props.value}
      </Text>
      <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
        {props.label}
      </Text>
    </View>
  );
}

/** School grades of one subject over time, as percent of the maximum score. */
export function TrendChart(props: {
  subject: Pick<DashboardSchoolSubject, 'subjectCode' | 'points'>;
  width?: number;
  height?: number;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const width = props.width ?? 300;
  const height = props.height ?? 120;
  const pts = chartPoints(props.subject.points, width, height);
  if (pts.length === 0) return null;
  const mid = chartPoints([{ percent: 50 }], width, height)[0]!.y;
  return (
    <View
      testID={`trend-chart-${props.subject.subjectCode}`}
      accessible
      accessibilityLabel={t('grades.chartLabel', {
        n: pts.length,
        list: props.subject.points.map((p) => `${p.percent}%`).join(', '),
      })}
    >
      <Svg width={width} height={height}>
        <Line x1={0} y1={mid} x2={width} y2={mid} stroke={c.border} strokeDasharray="4 4" />
        {pts.length > 1 && (
          <Polyline
            points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={c.primary}
            strokeWidth={2}
          />
        )}
        {pts.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={4} fill={c.primary} />
        ))}
      </Svg>
    </View>
  );
}

/** Parent home: one card per child. */
export function ChildOverviewCard(props: { card: ChildOverview; onPress: () => void }) {
  const theme = useTheme();
  const c = theme.colors;
  const { card } = props;
  return (
    <Pressable
      testID={`overview-${card.studentId}`}
      accessibilityRole="button"
      onPress={props.onPress}
      style={{
        gap: theme.spacing.xs,
        padding: theme.spacing.lg,
        backgroundColor: c.surface,
        borderRadius: theme.radii.lg,
        borderWidth: 1,
        borderColor: c.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Text style={{ fontSize: 28 }}>
          {AVATAR_GLYPHS[card.avatar as keyof typeof AVATAR_GLYPHS]}
        </Text>
        <Text style={[theme.typography.bodyStrong, { color: c.text, flex: 1 }]}>
          {card.displayName}
        </Text>
        <Text style={[theme.typography.caption, { color: c.primary }]}>{t('overview.open')}</Text>
      </View>
      {overviewLines(card).map((line) => (
        <Text
          key={line.key}
          testID={`overview-${line.key}-${card.studentId}`}
          style={[theme.typography.body, { color: c.text }]}
        >
          {line.text}
        </Text>
      ))}
    </Pressable>
  );
}
