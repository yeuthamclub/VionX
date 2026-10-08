/// <reference types="jest" />
import type { ConsentState } from '@vionx/contracts/client';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConsentRow } from './ConsentRow.tsx';
import { MarkdownText } from './MarkdownText.tsx';

const base: ConsentState = {
  type: 'AI_PERSONALIZATION',
  effective: false,
  reason: 'NOT_GRANTED',
  record: null,
  childAssentRequiredNow: true,
};

describe('ConsentRow', () => {
  it('offers to turn on a consent that is off and explains child assent', () => {
    const onGrant = jest.fn();
    render(<ConsentRow state={base} onGrant={onGrant} onRevoke={() => {}} />);
    expect(screen.getByText('Trợ lý AI')).toBeTruthy();
    expect(screen.getByTestId('consent-state-AI_PERSONALIZATION')).toHaveTextContent('Đang tắt');
    expect(screen.getByText(/Con từ 7 tuổi/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('grant-AI_PERSONALIZATION'));
    expect(onGrant).toHaveBeenCalled();
  });

  it('shows a granted consent waiting for the child, with turn off', () => {
    const onRevoke = jest.fn();
    render(
      <ConsentRow
        state={{
          ...base,
          reason: 'CHILD_ASSENT_PENDING',
          record: {
            id: 'r',
            consentType: 'AI_PERSONALIZATION',
            policyVersion: 1,
            status: 'GRANTED',
            grantedAt: '2026-10-08T00:00:00Z',
            grantedByParentId: null,
            revokedAt: null,
            revokedByType: null,
            childAssentRequired: true,
            childAssentStatus: 'PENDING',
            childAssentAt: null,
          },
        }}
        onGrant={() => {}}
        onRevoke={onRevoke}
      />,
    );
    expect(screen.getByTestId('consent-state-AI_PERSONALIZATION')).toHaveTextContent(
      'Đã bật, chờ con đồng ý',
    );
    fireEvent.press(screen.getByTestId('revoke-AI_PERSONALIZATION'));
    expect(onRevoke).toHaveBeenCalled();
  });
});

describe('MarkdownText', () => {
  it('renders headings, bullets and table rows without markup', () => {
    render(
      <MarkdownText
        source={'# Chính sách\n\n> **BẢN NHÁP**\n- một\n| A | B |\n|---|---|\n| `X` | y |'}
      />,
    );
    expect(screen.getByText('Chính sách')).toBeTruthy();
    expect(screen.getByText('BẢN NHÁP')).toBeTruthy();
    expect(screen.getByText('•  một')).toBeTruthy();
    expect(screen.getByText('X: y')).toBeTruthy();
  });
});
