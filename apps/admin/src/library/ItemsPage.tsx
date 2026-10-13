// Item list with filters (kept in the URL) and cursor pagination.
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo, useState, type FormEvent } from 'react';
import { libraryChoices } from './choices.ts';
import type { ItemFilters } from './edit.ts';
import { fetchItems, libraryKeys } from './queries.ts';
import { COGNITIVE_LEVELS, CONTENT_STATUSES, ITEM_KINDS, ITEM_TYPES } from './types.ts';
import { Empty, ErrorBox, LibrarySelect, Loading, StatusBadge, useOverview } from './ui.tsx';

function EnumSelect<T extends string>({
  label,
  values,
  value,
  onChange,
}: {
  label: string;
  values: readonly T[];
  value: T | undefined;
  onChange: (value: T | undefined) => void;
}) {
  return (
    <label>
      {label}
      <select
        value={value ?? ''}
        onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}
      >
        <option value="">Any</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ItemsPage({
  filters,
  onFiltersChange,
}: {
  filters: ItemFilters;
  onFiltersChange: (filters: ItemFilters) => void;
}) {
  const overview = useOverview();
  const choices = useMemo(() => libraryChoices(overview.data), [overview.data]);
  const set = (patch: Partial<ItemFilters>) => onFiltersChange({ ...filters, ...patch });
  // Free-text fields apply on submit, not per keystroke.
  const [skill, setSkill] = useState(filters.skill ?? '');
  const [q, setQ] = useState(filters.q ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    set({ skill: skill.trim() || undefined, q: q.trim() || undefined });
  };

  const items = useInfiniteQuery({
    queryKey: libraryKeys.items(filters),
    queryFn: ({ pageParam }) => fetchItems(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = items.data?.pages.flatMap((p) => p.items) ?? [];
  const libraryKey =
    filters.grade !== undefined && filters.subject ? `${filters.grade}-${filters.subject}` : '';

  return (
    <section className="library">
      <h1>Questions</h1>
      <form className="filters" onSubmit={submit}>
        <LibrarySelect
          choices={choices}
          value={libraryKey}
          allowAll
          onChange={(c) => set({ grade: c?.grade, subject: c?.subject, skill: undefined })}
        />
        <label>
          Skill code
          <input value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="MATH.6…" />
        </label>
        <EnumSelect
          label="Status"
          values={CONTENT_STATUSES}
          value={filters.status}
          onChange={(status) => set({ status })}
        />
        <EnumSelect
          label="Kind"
          values={ITEM_KINDS}
          value={filters.kind}
          onChange={(kind) => set({ kind })}
        />
        <EnumSelect
          label="Type"
          values={ITEM_TYPES}
          value={filters.type}
          onChange={(type) => set({ type })}
        />
        <EnumSelect
          label="Level"
          values={COGNITIVE_LEVELS}
          value={filters.level}
          onChange={(level) => set({ level })}
        />
        <label>
          Text
          <input
            value={q}
            maxLength={200}
            onChange={(e) => setQ(e.target.value)}
            placeholder="code or stem"
          />
        </label>
        <button type="submit">Search</button>
        <button type="button" className="link" onClick={() => onFiltersChange({})}>
          Clear
        </button>
      </form>

      {items.isPending && <Loading what="Loading items" />}
      {items.isError && !items.data && (
        <ErrorBox error={items.error} retry={() => void items.refetch()} />
      )}
      {items.data && rows.length === 0 && <Empty>No items match these filters.</Empty>}
      {rows.length > 0 && (
        <div className="card wide">
          <table className="rows">
            <thead>
              <tr>
                <th>Code</th>
                <th>Stem</th>
                <th>Type</th>
                <th>Level</th>
                <th>Diff.</th>
                <th>Skills</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link to="/content/questions/$id" params={{ id: item.id }}>
                      <code>{item.code}</code>
                    </Link>
                    {item.kind === 'TEMPLATE' && <span className="badge">TEMPLATE</span>}
                    {item.templateFlagged && <span className="error"> flagged</span>}
                  </td>
                  <td className="stem">{item.stemMd}</td>
                  <td>{item.type}</td>
                  <td>{item.cognitiveLevel}</td>
                  <td>{item.difficulty}</td>
                  <td className="muted">{item.skills.map((s) => s.code).join(', ')}</td>
                  <td>
                    <StatusBadge status={item.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="actions">
            <span className="muted">{rows.length} shown</span>
            {items.hasNextPage && (
              <button
                type="button"
                className="secondary"
                disabled={items.isFetchingNextPage}
                onClick={() => void items.fetchNextPage()}
              >
                {items.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
          {items.isFetchNextPageError && (
            <ErrorBox error={items.error} retry={() => void items.fetchNextPage()} />
          )}
        </div>
      )}
    </section>
  );
}
