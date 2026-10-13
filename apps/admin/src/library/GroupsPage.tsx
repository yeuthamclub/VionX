// Item groups (passages, poems, dialogues, picture scenes, experiments): list and editor.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { libraryChoices } from './choices.ts';
import { changedFields, nullIfBlank } from './edit.ts';
import { fetchGroup, fetchGroups, libraryKeys, patchGroup, type GroupFilters } from './queries.ts';
import {
  CONTENT_STATUSES,
  LIBRARY_EDIT,
  SOURCE_KINDS,
  type ContentStatus,
  type GroupDetail,
  type GroupPatch,
} from './types.ts';
import {
  Empty,
  ErrorBox,
  LibrarySelect,
  Loading,
  MediaPreview,
  RichText,
  SpeakButton,
  StatusBadge,
  useCan,
  useOverview,
} from './ui.tsx';

export function GroupsPage() {
  const overview = useOverview();
  const choices = useMemo(() => libraryChoices(overview.data), [overview.data]);
  const [filters, setFilters] = useState<GroupFilters>({});
  const groups = useQuery({
    queryKey: libraryKeys.groups(filters),
    queryFn: () => fetchGroups(filters),
  });
  const libraryKey =
    filters.grade !== undefined && filters.subject ? `${filters.grade}-${filters.subject}` : '';

  return (
    <section className="library">
      <h1>Groups</h1>
      <div className="filters">
        <LibrarySelect
          choices={choices}
          value={libraryKey}
          allowAll
          onChange={(c) => setFilters({ ...filters, grade: c?.grade, subject: c?.subject })}
        />
        <label>
          Status
          <select
            value={filters.status ?? ''}
            onChange={(e) =>
              setFilters({
                ...filters,
                status: (e.target.value || undefined) as ContentStatus | undefined,
              })
            }
          >
            <option value="">Any</option>
            {CONTENT_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      {groups.isPending && <Loading what="Loading groups" />}
      {groups.isError && <ErrorBox error={groups.error} retry={() => void groups.refetch()} />}
      {groups.data?.length === 0 && <Empty>No groups match these filters.</Empty>}
      {groups.data && groups.data.length > 0 && (
        <div className="card wide">
          <table className="rows">
            <thead>
              <tr>
                <th>Code</th>
                <th>Title</th>
                <th>Kind</th>
                <th>Library</th>
                <th>Items</th>
                <th>Source</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {groups.data.map((g) => (
                <tr key={g.id}>
                  <td>
                    <Link to="/content/groups/$id" params={{ id: g.id }}>
                      <code>{g.code}</code>
                    </Link>
                  </td>
                  <td>{g.title}</td>
                  <td>{g.stimulusKind}</td>
                  <td>
                    {g.grade}-{g.subject}
                  </td>
                  <td>{g.itemCount}</td>
                  <td className="muted">{g.sourceKind}</td>
                  <td>
                    <StatusBadge status={g.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function GroupEditorPage({ id }: { id: string }) {
  const group = useQuery({ queryKey: libraryKeys.group(id), queryFn: () => fetchGroup(id) });
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <section className="library">
      <p>
        <Link to="/content/groups">← Groups</Link>
      </p>
      {group.isPending && <Loading what="Loading group" />}
      {group.isError && <ErrorBox error={group.error} retry={() => void group.refetch()} />}
      {group.data && (
        <GroupForm
          key={`${group.data.id}:${group.data.version}`}
          group={group.data}
          notice={notice}
          setNotice={setNotice}
          reload={() => void group.refetch()}
        />
      )}
    </section>
  );
}

function GroupForm({
  group,
  notice,
  setNotice,
  reload,
}: {
  group: GroupDetail;
  notice: string | null;
  setNotice: (notice: string | null) => void;
  reload: () => void;
}) {
  const canEdit = useCan(LIBRARY_EDIT);
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(group.title);
  const [bodyMd, setBodyMd] = useState(group.bodyMd);
  const [ttsText, setTtsText] = useState(group.ttsText ?? '');
  const [ttsLang, setTtsLang] = useState<'' | 'vi' | 'en'>(group.ttsLang ?? '');
  const [genre, setGenre] = useState(group.genre ?? '');
  const [sourceKind, setSourceKind] = useState(group.sourceKind);
  const [sourceNote, setSourceNote] = useState(group.sourceNote ?? '');
  const [status, setStatus] = useState<ContentStatus>(group.status);

  const changes = changedFields(
    {
      title: group.title,
      bodyMd: group.bodyMd,
      ttsText: group.ttsText,
      ttsLang: group.ttsLang,
      genre: group.genre,
      sourceKind: group.sourceKind,
      sourceNote: group.sourceNote,
      status: group.status,
    },
    {
      title,
      bodyMd,
      ttsText: nullIfBlank(ttsText),
      ttsLang: ttsLang || null,
      genre: nullIfBlank(genre),
      sourceKind,
      sourceNote: nullIfBlank(sourceNote),
      status,
    },
  );
  const dirty = Object.keys(changes).length > 0;
  const needsNote = sourceKind !== 'ORIGINAL_AI' && !sourceNote.trim();

  const save = useMutation({
    mutationFn: () => patchGroup(group.id, { version: group.version, ...changes } as GroupPatch),
    onSuccess: async (updated) => {
      setNotice(`Saved ${Object.keys(changes).join(', ')} (version ${updated.version}).`);
      queryClient.setQueryData(libraryKeys.group(group.id), updated);
      await queryClient.invalidateQueries({ queryKey: libraryKeys.all });
    },
  });

  return (
    <>
      <h1>
        <code>{group.code}</code> <StatusBadge status={group.status} />
      </h1>
      <p className="muted">
        Lớp {group.grade} · {group.subject} · {group.stimulusKind} · {group.wordCount ?? '—'} words
        · version {group.version}
      </p>
      {!canEdit && (
        <p className="warn">Read only: editing needs CONTENT_ADMIN or CONTENT_REVIEWER.</p>
      )}
      <div className="editor">
        <form
          className="card fields"
          onSubmit={(e) => {
            e.preventDefault();
            if (canEdit && dirty && !needsNote) save.mutate();
          }}
        >
          <label>
            Title
            <input readOnly={!canEdit} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Body
            <textarea
              rows={12}
              readOnly={!canEdit}
              value={bodyMd}
              onChange={(e) => setBodyMd(e.target.value)}
            />
          </label>
          <div className="row">
            <label>
              TTS text
              <input
                readOnly={!canEdit}
                value={ttsText}
                onChange={(e) => setTtsText(e.target.value)}
              />
            </label>
            <label>
              TTS language
              <select
                disabled={!canEdit}
                value={ttsLang}
                onChange={(e) => setTtsLang(e.target.value as '' | 'vi' | 'en')}
              >
                <option value="">— (profile default)</option>
                <option value="vi">vi</option>
                <option value="en">en</option>
              </select>
            </label>
          </div>
          <div className="row">
            <label>
              Genre
              <input readOnly={!canEdit} value={genre} onChange={(e) => setGenre(e.target.value)} />
            </label>
            <label>
              Source
              <select
                disabled={!canEdit}
                value={sourceKind}
                onChange={(e) => setSourceKind(e.target.value as typeof sourceKind)}
              >
                {SOURCE_KINDS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                disabled={!canEdit}
                value={status}
                onChange={(e) => setStatus(e.target.value as ContentStatus)}
              >
                {CONTENT_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Source note
            <input
              readOnly={!canEdit}
              value={sourceNote}
              onChange={(e) => setSourceNote(e.target.value)}
              aria-invalid={needsNote}
            />
            {needsNote && <span className="error">{sourceKind} groups need a source note.</span>}
          </label>
          {canEdit && (
            <div className="actions">
              <button type="submit" disabled={!dirty || needsNote || save.isPending}>
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
              <span className="muted">
                {dirty ? `Changed: ${Object.keys(changes).join(', ')}` : 'No changes.'}
              </span>
            </div>
          )}
          {notice && !dirty && <p className="ok">{notice}</p>}
          {save.isError && (
            <p className="error" role="alert">
              {save.error.message}{' '}
              {save.error.message.includes('newer version') && (
                <button type="button" className="secondary" onClick={reload}>
                  Reload (discards your edits)
                </button>
              )}
            </p>
          )}
        </form>

        <div className="card preview">
          <h2>{title}</h2>
          <RichText text={bodyMd} />
          <h3>Speech</h3>
          <p className="muted">{ttsText.trim() ? 'TTS text' : 'No TTS text; reads the body'}</p>
          <SpeakButton text={ttsText.trim() || bodyMd} lang={ttsLang || null} />
          <h3>Media</h3>
          <MediaPreview media={group.media} />
          <h3>Items ({group.items.length})</h3>
          {group.items.length === 0 ? (
            <p className="muted">No items use this group.</p>
          ) : (
            <ol>
              {[...group.items]
                .sort((a, b) => (a.groupOrder ?? 0) - (b.groupOrder ?? 0))
                .map((item) => (
                  <li key={item.id}>
                    <Link to="/content/questions/$id" params={{ id: item.id }}>
                      <code>{item.code}</code>
                    </Link>{' '}
                    {item.type} <StatusBadge status={item.status} />
                    <div className="muted stem">{item.stemMd}</div>
                  </li>
                ))}
            </ol>
          )}
        </div>
      </div>
    </>
  );
}
