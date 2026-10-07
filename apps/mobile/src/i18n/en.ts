import type { vi } from './vi.ts';

// English fallback. Every key must exist here; Vietnamese may lag behind for new keys.
export const en: Record<keyof typeof vi, string> = {
  'app.name': 'VionX',
  'welcome.title': 'Welcome to VionX',
  'welcome.subtitle': 'Who is using this phone?',
  'welcome.parent': 'Parent',
  'welcome.parentHint': 'Manage family, schedules and rewards',
  'welcome.child': 'Child',
  'welcome.childHint': 'Study, complete quests, earn XP',
  'health.title': 'Server connection',
  'health.checking': 'Checking…',
  'health.ok': 'All systems go',
  'health.degraded': 'Some services are down',
  'health.offline': 'Cannot reach the server',
  'health.retry': 'Retry',
  'health.check.db': 'Database',
  'health.check.storage': 'Storage',
  'health.check.queue': 'Queue',
  'health.check.ai': 'AI',
  'parent.placeholder': 'Parent mode arrives with M01.',
  'child.placeholder': 'Child mode arrives with M01.',
  'common.back': 'Back',
};
