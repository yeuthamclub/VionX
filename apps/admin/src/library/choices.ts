// Grade-subject choices for the library selectors.
import type { LibraryOverview } from './types.ts';

export interface LibraryChoice {
  key: string;
  curriculumVersion: string;
  grade: number;
  subject: string;
  label: string;
}

/** Imported libraries plus the launch profiles not imported yet, ordered by grade then subject. */
export function libraryChoices(overview: LibraryOverview | undefined): LibraryChoice[] {
  if (!overview) return [];
  const version = overview.versions[0]?.code ?? 'gdpt2018';
  const choices = new Map<string, LibraryChoice>();
  for (const lib of overview.libraries) {
    const key = `${lib.grade}-${lib.subject}`;
    choices.set(key, {
      key,
      curriculumVersion: lib.curriculumVersion,
      grade: lib.grade,
      subject: lib.subject,
      label: `Lớp ${lib.grade} · ${lib.titleVi ?? lib.subject} (${lib.items} items)`,
    });
  }
  for (const p of overview.profiles) {
    const key = `${p.grade}-${p.subject}`;
    if (!choices.has(key)) {
      choices.set(key, {
        key,
        curriculumVersion: version,
        grade: p.grade,
        subject: p.subject,
        label: `Lớp ${p.grade} · ${p.titleVi} (not imported)`,
      });
    }
  }
  return [...choices.values()].sort((a, b) => a.grade - b.grade || a.key.localeCompare(b.key));
}
