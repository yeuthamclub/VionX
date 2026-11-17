/// <reference types="jest" />
import type { ChildOverview } from '@vionx/contracts/client';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ChildOverviewCard, Figure, SufficiencyBadge, TrendChart } from './dashboard.tsx';

jest.mock('react-native-svg', () => {
  const { View } = jest.requireActual('react-native');
  const shape = (name: string) => (props: Record<string, unknown>) => (
    <View testID={name} accessibilityHint={JSON.stringify(props)} />
  );
  return {
    __esModule: true,
    default: (props: { children: unknown }) => <View testID="svg">{props.children as never}</View>,
    Circle: shape('circle'),
    Line: shape('line'),
    Polyline: shape('polyline'),
  };
});

const card: ChildOverview = {
  studentId: 's1',
  displayName: 'Minh',
  grade: 6,
  avatar: 'fox',
  today: {
    itemsTotal: 5,
    itemsDone: 2,
    plannedMinutes: 40,
    doneMinutes: 35,
    budgetMinutes: 75,
    completion: 0.4,
  },
  streak: { days: 3, activeDays: 4, sufficiency: 'LOW' },
  coinBalance: 12,
  coinsToday: 1,
  coinsWeek: 6,
  skillsImproving: 0,
  skillsAtRisk: 0,
  skillsSufficiency: 'INSUFFICIENT',
  upcomingExams: [
    { eventId: 'e1', title: 'Giữa kì', subjectCode: 'TOAN', startsAt: '', daysUntil: 3 },
  ],
};

describe('dashboard components', () => {
  it('every label of data sufficiency is spelled out', () => {
    const { rerender } = render(<SufficiencyBadge level="INSUFFICIENT" testID="b" />);
    expect(screen.getByTestId('b')).toHaveTextContent('Chưa đủ dữ liệu');
    rerender(<SufficiencyBadge level="LOW" testID="b" />);
    expect(screen.getByTestId('b')).toHaveTextContent('Dữ liệu còn ít');
    rerender(<SufficiencyBadge level="OK" testID="b" />);
    expect(screen.getByTestId('b')).toHaveTextContent('Đủ dữ liệu');
  });

  it('a figure shows its value and caption', () => {
    render(<Figure testID="f" label="việc đã xong" value="2/5" />);
    expect(screen.getByTestId('f')).toHaveTextContent('2/5');
    expect(screen.getByText('việc đã xong')).toBeTruthy();
  });

  it('the child card shows Today, streak, Coin, the skills line and the next exam, and opens', () => {
    const onPress = jest.fn();
    render(<ChildOverviewCard card={card} onPress={onPress} />);
    expect(screen.getByTestId('overview-today-s1')).toHaveTextContent('Hôm nay: xong 2/5 việc');
    expect(screen.getByTestId('overview-streak-s1')).toHaveTextContent('Chuỗi ngày liên tiếp: 3');
    expect(screen.getByTestId('overview-coins-s1')).toHaveTextContent(
      'Coin hôm nay: 1 · 7 ngày qua: 6',
    );
    expect(screen.getByTestId('overview-skills-s1')).toHaveTextContent(
      'Kỹ năng: chưa đủ dữ liệu để nhận xét',
    );
    expect(screen.getByTestId('overview-exam-s1')).toHaveTextContent('Giữa kì: còn 3 ngày');
    fireEvent.press(screen.getByTestId('overview-s1'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('the trend chart draws one dot per grade and a line from two grades on', () => {
    const subject = (percents: number[]) => ({
      subjectCode: 'TOAN',
      points: percents.map((percent, i) => ({
        day: `2026-11-0${i + 1}`,
        percent,
        type: 'ORAL' as const,
      })),
    });
    const { rerender } = render(<TrendChart subject={subject([80, 80, 90])} />);
    expect(screen.getAllByTestId('circle')).toHaveLength(3);
    expect(screen.getAllByTestId('polyline')).toHaveLength(1);
    expect(screen.getByTestId('trend-chart-TOAN').props.accessibilityLabel).toBe(
      'Biểu đồ 3 bài kiểm tra: 80%, 80%, 90%',
    );
    rerender(<TrendChart subject={subject([70])} />);
    expect(screen.getAllByTestId('circle')).toHaveLength(1);
    expect(screen.queryByTestId('polyline')).toBeNull();
    rerender(<TrendChart subject={subject([])} />);
    expect(screen.queryByTestId('trend-chart-TOAN')).toBeNull();
  });
});
