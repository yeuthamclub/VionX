/// <reference types="jest" />
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppError } from '../lib/api-error.ts';
import { CredentialCard } from './CredentialCard.tsx';
import { PinKeypad } from './PinKeypad.tsx';
import { StateView } from './StateView.tsx';

describe('PinKeypad', () => {
  it('reports digits, backspace and clear', () => {
    const onChange = jest.fn();
    const { rerender } = render(<PinKeypad value="12" onChange={onChange} />);
    fireEvent.press(screen.getByTestId('pin-key-7'));
    expect(onChange).toHaveBeenLastCalledWith('127');
    fireEvent.press(screen.getByTestId('pin-key-back'));
    expect(onChange).toHaveBeenLastCalledWith('1');
    fireEvent.press(screen.getByTestId('pin-key-clear'));
    expect(onChange).toHaveBeenLastCalledWith('');
    rerender(<PinKeypad value="12345678" onChange={onChange} />);
    fireEvent.press(screen.getByTestId('pin-key-9'));
    expect(onChange).toHaveBeenLastCalledWith('12345678');
  });

  it('never shows the PIN digits', () => {
    render(<PinKeypad value="2468" onChange={() => {}} />);
    expect(screen.queryByText('2468')).toBeNull();
    expect(screen.getByTestId('pin-dots').props.accessibilityLabel).toBe('4');
  });
});

describe('CredentialCard', () => {
  it('shows the login id and PIN once', () => {
    render(<CredentialCard displayName="Minh" childLoginId="vx-demy66" pin="2468" />);
    expect(screen.getByTestId('credential-login-id')).toHaveTextContent('vx-demy66');
    expect(screen.getByTestId('credential-pin')).toHaveTextContent('2468');
    expect(screen.getByText('VionX · Minh')).toBeTruthy();
  });
});

describe('StateView', () => {
  const child = (data: string[]) => <>{data.join(',')}</>;

  it('renders loading, offline, server error, empty and ready states', () => {
    const reload = jest.fn();
    const { rerender } = render(
      <StateView state={{ kind: 'loading' }} reload={reload}>
        {child}
      </StateView>,
    );
    expect(screen.getByTestId('state-loading')).toBeTruthy();

    rerender(
      <StateView state={{ kind: 'error', error: new AppError('offline', 0) }} reload={reload}>
        {child}
      </StateView>,
    );
    expect(screen.getByTestId('state-offline')).toBeTruthy();
    fireEvent.press(screen.getByText('Thử lại'));
    expect(reload).toHaveBeenCalled();

    rerender(
      <StateView state={{ kind: 'error', error: new AppError('api', 500) }} reload={reload}>
        {child}
      </StateView>,
    );
    expect(screen.getByTestId('state-error')).toBeTruthy();

    rerender(
      <StateView
        state={{ kind: 'ready', data: [] }}
        reload={reload}
        isEmpty={(d) => d.length === 0}
        empty={<>{'Chưa có con nào'}</>}
      >
        {child}
      </StateView>,
    );
    expect(screen.getByTestId('state-empty')).toBeTruthy();
  });
});
