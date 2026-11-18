/// <reference types="jest" />
import type { TodayItem } from '@vionx/contracts/client';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { TodayCard } from './TodayCard.tsx';

const item = (over: Partial<TodayItem> = {}): TodayItem => ({
  id: 'i1',
  kind: 'EXAM_PREP',
  title: 'Cộng hai phân số',
  subject: 'math',
  minutes: 25,
  priority: 66,
  reasons: [
    { code: 'EXAM_SOON', points: 24, params: { examTitle: 'Kiểm tra giữa kì', days: 3 } },
    { code: 'NEXT_IN_CURRICULUM', points: 10 },
    { code: 'EXAM_RELEVANT', points: 32 },
  ],
  status: 'PLANNED',
  pinned: false,
  required: false,
  inBudget: true,
  rewardXp: 75,
  link: { type: 'SESSION', mode: 'PRACTICE', skillIds: ['s1'], subject: 'math' },
  detail: { examTitle: 'Kiểm tra giữa kì', daysUntil: 3 },
  ...over,
});
const task = (over: Partial<TodayItem> = {}) =>
  item({
    kind: 'HOMEWORK',
    title: 'Bài tập Toán',
    required: true,
    rewardXp: 20,
    link: { type: 'TASK', taskId: 't1', occurrenceId: 'o1', verificationMode: 'SELF_CHECK' },
    reasons: [{ code: 'DUE_TODAY', points: 30, params: { required: true } }],
    detail: {},
    ...over,
  });

describe('TodayCard', () => {
  it('child: a learning card shows duration and reward hint, and starts or skips', () => {
    const onStart = jest.fn();
    const onSkip = jest.fn();
    render(<TodayCard item={item()} mode="child" onStart={onStart} onSkip={onSkip} />);
    expect(screen.getByText('Cộng hai phân số')).toBeTruthy();
    expect(screen.getByText('Ôn thi · Kiểm tra giữa kì')).toBeTruthy();
    expect(screen.getByTestId('today-minutes-i1')).toHaveTextContent('25 phút');
    expect(screen.getByTestId('today-reward-i1')).toHaveTextContent('tới +75 XP');
    expect(screen.getByTestId('today-status-i1')).toHaveTextContent('Chưa làm');
    expect(screen.queryByTestId('today-reasons-i1')).toBeNull();
    expect(screen.queryByTestId('today-complete-i1')).toBeNull();
    fireEvent.press(screen.getByTestId('today-start-i1'));
    fireEvent.press(screen.getByTestId('today-skip-i1'));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('child: a required task is completed by hand and cannot be skipped', () => {
    const onComplete = jest.fn();
    render(<TodayCard item={task()} mode="child" onComplete={onComplete} onSkip={jest.fn()} />);
    expect(screen.getByTestId('today-reward-i1')).toHaveTextContent('+20 XP');
    expect(screen.queryByTestId('today-skip-i1')).toBeNull();
    expect(screen.queryByTestId('today-start-i1')).toBeNull();
    fireEvent.press(screen.getByTestId('today-complete-i1'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('child: a done card has no buttons', () => {
    render(
      <TodayCard
        item={item({ status: 'DONE' })}
        mode="child"
        onStart={jest.fn()}
        onSkip={jest.fn()}
      />,
    );
    expect(screen.getByTestId('today-status-i1')).toHaveTextContent('Đã xong');
    expect(screen.queryByTestId('today-start-i1')).toBeNull();
    expect(screen.queryByTestId('today-skip-i1')).toBeNull();
  });

  it('parent: reasons with points, pin and remove', () => {
    const onPin = jest.fn();
    const onRemove = jest.fn();
    render(<TodayCard item={item()} mode="parent" onPin={onPin} onRemove={onRemove} />);
    const reasons = screen.getByTestId('today-reasons-i1');
    expect(reasons).toHaveTextContent(/Điểm ưu tiên: 66/);
    expect(reasons).toHaveTextContent(/Còn 3 ngày nữa là "Kiểm tra giữa kì" \(\+24\)/);
    expect(reasons).toHaveTextContent(/Kỹ năng nằm trong bài kiểm tra \(\+32\)/);
    expect(screen.queryByTestId('today-start-i1')).toBeNull();
    fireEvent.press(screen.getByTestId('today-pin-i1'));
    fireEvent.press(screen.getByTestId('today-remove-i1'));
    expect(onPin).toHaveBeenCalledWith(true);
    expect(onRemove).toHaveBeenCalledWith(true);
  });

  it('parent: a pinned item offers unpin, a removed item offers to put it back', () => {
    const onPin = jest.fn();
    const onRemove = jest.fn();
    const { rerender } = render(
      <TodayCard item={item({ pinned: true })} mode="parent" onPin={onPin} onRemove={onRemove} />,
    );
    expect(screen.getByTestId('today-pin-i1')).toHaveTextContent('Bỏ ghim');
    fireEvent.press(screen.getByTestId('today-pin-i1'));
    expect(onPin).toHaveBeenCalledWith(false);
    rerender(
      <TodayCard
        item={item({ status: 'REMOVED' })}
        mode="parent"
        onPin={onPin}
        onRemove={onRemove}
      />,
    );
    expect(screen.queryByTestId('today-pin-i1')).toBeNull();
    expect(screen.getByTestId('today-remove-i1')).toHaveTextContent('Đưa lại vào');
    fireEvent.press(screen.getByTestId('today-remove-i1'));
    expect(onRemove).toHaveBeenCalledWith(false);
  });
});
