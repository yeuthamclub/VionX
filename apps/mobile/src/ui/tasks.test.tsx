/// <reference types="jest" />
import type { TaskOccurrence } from '@vionx/contracts/client';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Chip } from './Chip.tsx';
import { TaskCard } from './TaskCard.tsx';

const occurrence = (over: Partial<TaskOccurrence> = {}): TaskOccurrence => ({
  id: 'o1',
  taskId: 't1',
  studentId: 's1',
  date: '2026-10-13',
  status: 'ASSIGNED',
  type: 'HOMEWORK',
  title: 'Làm bài tập về nhà',
  description: null,
  subjectCode: 'TOAN',
  windowStart: '19:30',
  windowEnd: '20:30',
  durationMinutes: 45,
  priority: 'HIGH',
  required: true,
  rewardXp: 20,
  verificationMode: 'PARENT_APPROVAL',
  recurring: true,
  completion: null,
  ...over,
});

describe('TaskCard', () => {
  it('lets the child complete today’s open task', () => {
    const onComplete = jest.fn();
    render(
      <TaskCard
        occurrence={occurrence()}
        today="2026-10-13"
        mode="child"
        onComplete={onComplete}
      />,
    );
    expect(screen.getByText('Làm bài tập về nhà')).toBeTruthy();
    expect(screen.getByText('+20 XP')).toBeTruthy();
    expect(screen.getByTestId('task-status-t1')).toHaveTextContent('Chưa làm');
    fireEvent.press(screen.getByTestId('complete-t1'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('complete-t1')).toHaveTextContent('Con làm xong rồi!');
  });

  it('asks for a photo for PHOTO_PROOF tasks and shows the parent’s note after a rejection', () => {
    render(
      <TaskCard
        occurrence={occurrence({
          verificationMode: 'PHOTO_PROOF',
          status: 'REJECTED',
          completion: {
            id: 'c1',
            clientUuid: 'u1',
            status: 'REJECTED',
            completedAt: '2026-10-13T10:00:00Z',
            decidedAt: '2026-10-13T11:00:00Z',
            decidedByType: 'parent',
            decisionNote: 'Dọn lại nhé',
            hasProof: true,
          },
        })}
        today="2026-10-13"
        mode="child"
        onComplete={() => {}}
      />,
    );
    expect(screen.getByTestId('complete-t1')).toHaveTextContent('Chụp ảnh và gửi');
    expect(screen.getByText('Bố mẹ nhắn: Dọn lại nhé')).toBeTruthy();
  });

  it('hides the button while waiting for the parent or on a future day', () => {
    const { rerender } = render(
      <TaskCard
        occurrence={occurrence({ status: 'PENDING_APPROVAL' })}
        today="2026-10-13"
        mode="child"
        onComplete={() => {}}
      />,
    );
    expect(screen.queryByTestId('complete-t1')).toBeNull();
    expect(screen.getByTestId('task-status-t1')).toHaveTextContent('Chờ bố mẹ duyệt');
    rerender(
      <TaskCard
        occurrence={occurrence({ date: '2026-10-14' })}
        today="2026-10-13"
        mode="child"
        onComplete={() => {}}
      />,
    );
    expect(screen.queryByTestId('complete-t1')).toBeNull();
  });

  it('parent mode shows the verification mode and never a complete button', () => {
    const onPress = jest.fn();
    render(
      <TaskCard occurrence={occurrence()} today="2026-10-13" mode="parent" onPress={onPress} />,
    );
    expect(screen.getByText('19:30 – 20:30 · Bố mẹ duyệt')).toBeTruthy();
    expect(screen.queryByTestId('complete-t1')).toBeNull();
    fireEvent.press(screen.getByTestId('task-t1-2026-10-13'));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('Chip', () => {
  it('reports presses and selection', () => {
    const onPress = jest.fn();
    render(<Chip testID="chip" label="Hằng ngày" selected onPress={onPress} />);
    fireEvent.press(screen.getByTestId('chip'));
    expect(onPress).toHaveBeenCalled();
    expect(screen.getByTestId('chip').props.accessibilityState).toMatchObject({ selected: true });
  });
});
