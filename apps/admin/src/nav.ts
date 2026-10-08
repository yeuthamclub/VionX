// Admin navigation from Master Spec §33.1. Every leaf is a stub page until its module lands.

export interface NavLeaf {
  label: string;
  path: string;
  /** Module that implements the screen. */
  module: string;
}

export interface NavGroup {
  label: string;
  children: NavLeaf[];
}

export type NavEntry = NavLeaf | NavGroup;

export const NAV: NavEntry[] = [
  { label: 'Dashboard', path: '/', module: 'M00' },
  {
    label: 'Library',
    children: [
      { label: 'Books', path: '/library/books', module: 'M10' },
      { label: 'Import', path: '/library/import', module: 'M10' },
      { label: 'Processing Queue', path: '/library/processing-queue', module: 'M11' },
      { label: 'Sources', path: '/library/sources', module: 'M13' },
    ],
  },
  {
    label: 'Curriculum',
    children: [
      { label: 'Grades', path: '/curriculum/grades', module: 'M05' },
      { label: 'Subjects', path: '/curriculum/subjects', module: 'M05' },
      { label: 'Chapters', path: '/curriculum/chapters', module: 'M05' },
      { label: 'Lessons', path: '/curriculum/lessons', module: 'M05' },
      { label: 'Concepts', path: '/curriculum/concepts', module: 'M05' },
      { label: 'Skills', path: '/curriculum/skills', module: 'M05' },
    ],
  },
  { label: 'Knowledge Graph', path: '/knowledge-graph', module: 'M12' },
  {
    label: 'Learning Content',
    children: [
      { label: 'Learning Packs', path: '/content/learning-packs', module: 'M14' },
      { label: 'Questions', path: '/content/questions', module: 'M05' },
      { label: 'Flashcards', path: '/content/flashcards', module: 'M14' },
      { label: 'Reviews', path: '/content/reviews', module: 'M14' },
    ],
  },
  {
    label: 'AI Factory',
    children: [
      { label: 'Generation Jobs', path: '/ai/generation-jobs', module: 'M14' },
      { label: 'Validation', path: '/ai/validation', module: 'M14' },
      { label: 'Prompt Versions', path: '/ai/prompt-versions', module: 'M14' },
      { label: 'Model Config', path: '/ai/model-config', module: 'M14' },
    ],
  },
  { label: 'Students', path: '/students', module: 'M08' },
  { label: 'Competitions', path: '/competitions', module: 'M20' },
  { label: 'Analytics', path: '/analytics', module: 'M09' },
  { label: 'Privacy & Audit', path: '/privacy-audit', module: 'M02' },
  { label: 'System', path: '/system', module: 'M09' },
];

export const isGroup = (entry: NavEntry): entry is NavGroup => 'children' in entry;

/** All leaf pages, in navigation order. */
export function navLeaves(entries: NavEntry[] = NAV): NavLeaf[] {
  return entries.flatMap((entry) => (isGroup(entry) ? entry.children : [entry]));
}
