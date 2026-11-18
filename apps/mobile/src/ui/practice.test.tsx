/// <reference types="jest" />
import type { PracticeGroup, PracticeItem, PracticeOption } from '@vionx/contracts/client';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Speech from 'expo-speech';
import { useState } from 'react';
import { emptyDraft, isComplete, toResponse, type Draft } from '../lib/practice.ts';
import { GroupStimulus } from './practice/GroupStimulus.tsx';
import { ItemView } from './practice/ItemView.tsx';
import { mathHtml, RichText } from './practice/RichText.tsx';
import { StateBadge } from './practice/StateBadge.tsx';

jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
jest.mock('react-native-webview', () => {
  const { View } = jest.requireActual('react-native');
  return { WebView: (props: object) => <View testID="webview" {...props} /> };
});
jest.mock('react-native-svg', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SvgXml: (props: { xml: string }) => <View testID="svg" accessibilityHint={props.xml} />,
  };
});

const opt = (id: string, over: Partial<PracticeOption> = {}): PracticeOption => ({
  id,
  text: `Lựa chọn ${id}`,
  media: null,
  ttsText: null,
  side: null,
  ...over,
});
const item = (type: PracticeItem['type'], over: Partial<PracticeItem> = {}): PracticeItem => ({
  id: 'i1',
  type,
  kind: 'STATIC',
  skillId: 's1',
  slotKind: 'CURRENT',
  difficulty: 2,
  stemMd: 'Câu hỏi',
  media: [],
  options: [opt('a'), opt('b'), opt('c')],
  blanks: 0,
  ttsText: 'Câu hỏi',
  ttsLang: 'vi',
  seed: null,
  hintsTotal: 4,
  hints: [],
  ...over,
});

let latest: Draft;
function Harness({ it: i, young = true }: { it: PracticeItem; young?: boolean }) {
  const [draft, setDraft] = useState(emptyDraft(i));
  latest = draft;
  return <ItemView item={i} draft={draft} onChange={setDraft} young={young} />;
}
const answer = (i: PracticeItem) => (isComplete(i, latest) ? toResponse(i, latest) : null);

describe('ItemView renders every practice item type', () => {
  it.each(['single_choice', 'spelling_choice', 'picture_choice'] as const)('%s', (type) => {
    const i = item(type);
    render(<Harness it={i} />);
    expect(screen.getByTestId(`item-${type}`)).toBeTruthy();
    expect(answer(i)).toBeNull();
    fireEvent.press(screen.getByTestId('option-b'));
    expect(answer(i)).toEqual({ optionId: 'b' });
  });

  it('multi_choice', () => {
    const i = item('multi_choice');
    render(<Harness it={i} />);
    fireEvent.press(screen.getByTestId('option-a'));
    fireEvent.press(screen.getByTestId('option-c'));
    expect(answer(i)).toEqual({ optionIds: ['a', 'c'] });
  });

  it('true_false', () => {
    const i = item('true_false', { options: [] });
    render(<Harness it={i} />);
    fireEvent.press(screen.getByTestId('option-false'));
    expect(answer(i)).toEqual({ value: false });
  });

  it('numeric: answered with the on-screen keypad only', () => {
    const i = item('numeric', { options: [] });
    render(<Harness it={i} />);
    for (const key of ['4', '7', '⌫', '2']) fireEvent.press(screen.getByTestId(`key-${key}`));
    expect(screen.getByTestId('numeric-display')).toHaveTextContent('42');
    expect(answer(i)).toEqual({ value: '42' });
  });

  it('fill_blank', () => {
    const i = item('fill_blank', { options: [], blanks: 2 });
    render(<Harness it={i} />);
    fireEvent.changeText(screen.getByTestId('blank-0'), 'Hà Nội');
    expect(answer(i)).toBeNull();
    fireEvent.changeText(screen.getByTestId('blank-1'), '5');
    expect(answer(i)).toEqual({ blanks: ['Hà Nội', '5'] });
  });

  it('word_bank: tap a word into the gap, tap the gap to take it back', () => {
    const i = item('word_bank', { blanks: 1 });
    render(<Harness it={i} />);
    fireEvent.press(screen.getByTestId('option-b'));
    expect(answer(i)).toEqual({ blankOptionIds: ['b'] });
    expect(screen.queryByTestId('option-b')).toBeNull();
    fireEvent.press(screen.getByTestId('slot-0'));
    expect(answer(i)).toBeNull();
  });

  it('ordering by tapping', () => {
    const i = item('ordering');
    render(<Harness it={i} />);
    for (const id of ['c', 'a', 'b']) fireEvent.press(screen.getByTestId(`option-${id}`));
    expect(answer(i)).toEqual({ order: ['c', 'a', 'b'] });
  });

  it('matching', () => {
    const i = item('matching', {
      options: [
        opt('l1', { side: 'left' }),
        opt('l2', { side: 'left' }),
        opt('r1', { side: 'right' }),
        opt('r2', { side: 'right' }),
      ],
    });
    render(<Harness it={i} />);
    for (const id of ['l1', 'r2', 'l2', 'r1']) fireEvent.press(screen.getByTestId(`option-${id}`));
    expect(answer(i)).toEqual({
      pairs: [
        ['l1', 'r2'],
        ['l2', 'r1'],
      ],
    });
  });

  it('young mode uses large touch targets; a locked item ignores taps', () => {
    const i = item('single_choice');
    const view = render(
      <ItemView item={i} draft={emptyDraft(i)} onChange={jest.fn()} young disabled />,
    );
    expect(screen.getByTestId('option-a')).toHaveStyle({ minHeight: 64 });
    expect(screen.getByTestId('option-a')).toBeDisabled();
    view.unmount();
  });

  it('shows SVG pictures of the stem and of picture options', () => {
    const svg = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
    const media = { id: 'm1', kind: 'SVG' as const, svg, storagePath: null, alt: 'Ba quả táo' };
    render(
      <Harness
        it={item('picture_choice', {
          media: [media],
          options: [opt('a', { text: null, media: { ...media, id: 'm2', alt: 'Hai quả cam' } })],
        })}
      />,
    );
    expect(screen.getAllByTestId('svg')).toHaveLength(2);
    expect(screen.getByLabelText('Ba quả táo')).toBeTruthy();
    expect(screen.getAllByLabelText('Hai quả cam').length).toBeGreaterThan(0);
  });
});

describe('read aloud', () => {
  beforeEach(() => jest.clearAllMocks());

  it('every item has a speaker button that reads the stem and options in Vietnamese', () => {
    render(
      <Harness it={item('single_choice', { options: [opt('a', { ttsText: 'A' }), opt('b')] })} />,
    );
    fireEvent.press(screen.getByTestId('speak-item'));
    expect(Speech.speak).toHaveBeenCalledWith(
      'Câu hỏi. A. Lựa chọn b',
      expect.objectContaining({ language: 'vi-VN' }),
    );
  });

  it('uses the English voice for English items', () => {
    render(
      <Harness
        it={item('true_false', { options: [], ttsText: 'The cat is big.', ttsLang: 'en' })}
      />,
    );
    fireEvent.press(screen.getByTestId('speak-item'));
    expect(Speech.speak).toHaveBeenCalledWith(
      'The cat is big.',
      expect.objectContaining({ language: 'en-US' }),
    );
  });
});

describe('passage group', () => {
  const group: PracticeGroup = {
    id: 'g1',
    stimulusKind: 'PASSAGE',
    title: 'Bé Na tưới cây',
    bodyMd: 'Sáng nay bé Na ra vườn.',
    ttsText: null,
    ttsLang: 'vi',
    media: [],
    position: 2,
    total: 3,
  };

  it('shows the passage with its place, folds and unfolds, and can be read aloud', () => {
    render(<GroupStimulus group={group} young />);
    expect(screen.getByText('Sáng nay bé Na ra vườn.')).toBeTruthy();
    expect(screen.getByText('Câu 2/3 của bài đọc')).toBeTruthy();
    fireEvent.press(screen.getByTestId('group-toggle'));
    expect(screen.queryByTestId('group-body')).toBeNull();
    expect(screen.getByText(/Bé Na tưới cây/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('group-toggle'));
    expect(screen.getByTestId('group-body')).toBeTruthy();
    fireEvent.press(screen.getByTestId('speak-group'));
    expect(Speech.speak).toHaveBeenCalledWith('Sáng nay bé Na ra vườn.', expect.anything());
  });
});

describe('RichText and StateBadge', () => {
  it('plain text renders without a WebView; TeX goes through KaTeX MathML', () => {
    const plain = render(<RichText source="Số **lớn** nhất" testID="t" />);
    expect(screen.getByTestId('t')).toHaveTextContent('Số lớn nhất');
    expect(screen.queryByTestId('webview')).toBeNull();
    plain.unmount();
    render(<RichText source="Tính $\frac{1}{2}$" />);
    expect(screen.getByTestId('webview')).toBeTruthy();
    const html = mathHtml('Tính $\\frac{1}{2}$ <b>&', '#000', 16);
    expect(html).toContain('<mfrac>');
    expect(html).toContain('&lt;b&gt;&amp;');
    expect(html).not.toContain('<script');
  });

  it('labels the mastery states in Vietnamese', () => {
    render(<StateBadge state="PROFICIENT" testID="b" />);
    expect(screen.getByTestId('b')).toHaveTextContent('Thành thạo');
  });
});
