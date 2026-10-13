// Curriculum tree browser of one grade-subject, with item counts and the coverage report.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { libraryChoices, type LibraryChoice } from './choices.ts';
import { fetchCoverage, fetchCurriculum, libraryKeys } from './queries.ts';
import { branchIds, buildTree, type TreeNode } from './tree.ts';
import type { CurriculumNode } from './types.ts';
import { CoverageSummary, Empty, ErrorBox, LibrarySelect, Loading, useOverview } from './ui.tsx';

export function CurriculumPage() {
  const overview = useOverview();
  const choices = useMemo(() => libraryChoices(overview.data), [overview.data]);
  const [key, setKey] = useState<string | null>(null);
  // Default: the first imported library, else the first launch profile.
  const imported = overview.data?.libraries[0];
  const selected =
    choices.find((c) => c.key === key) ??
    choices.find((c) => imported && c.key === `${imported.grade}-${imported.subject}`) ??
    choices[0];

  return (
    <section className="library">
      <h1>Curriculum tree</h1>
      {overview.isPending && <Loading />}
      {overview.isError && (
        <ErrorBox error={overview.error} retry={() => void overview.refetch()} />
      )}
      {overview.data && !selected && (
        <Empty>No curriculum yet. Import a library package under Library → Library packages.</Empty>
      )}
      {selected && (
        <>
          <div className="filters">
            <LibrarySelect
              choices={choices}
              value={selected.key}
              onChange={(c) => c && setKey(c.key)}
            />
          </div>
          <Tree key={selected.key} library={selected} />
          <Coverage library={selected} />
        </>
      )}
    </section>
  );
}

function Tree({ library }: { library: LibraryChoice }) {
  const { curriculumVersion: v, grade, subject } = library;
  const curriculum = useQuery({
    queryKey: libraryKeys.curriculum(v, grade, subject),
    queryFn: () => fetchCurriculum(v, grade, subject),
  });
  const roots = useMemo(() => buildTree(curriculum.data?.nodes ?? []), [curriculum.data]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  if (curriculum.isPending) return <Loading what="Loading curriculum" />;
  if (curriculum.isError)
    return <ErrorBox error={curriculum.error} retry={() => void curriculum.refetch()} />;
  if (roots.length === 0)
    return <Empty>This library has no curriculum nodes yet. Import its package first.</Empty>;

  const skills = curriculum.data.nodes.filter((n) => n.level === 'SKILL');
  return (
    <div className="card wide">
      <div className="actions">
        <h2>Nodes</h2>
        <span className="muted">
          {curriculum.data.nodes.length} nodes · {skills.length} skills,{' '}
          {skills.filter((s) => s.active).length} active · {curriculum.data.edges.length} edges
        </span>
        <button type="button" className="link" onClick={() => setCollapsed(new Set())}>
          Expand all
        </button>
        <button
          type="button"
          className="link"
          onClick={() => setCollapsed(new Set(branchIds(roots)))}
        >
          Collapse all
        </button>
      </div>
      <ul className="tree">
        {roots.map((node) => (
          <NodeRow
            key={node.id}
            node={node}
            library={library}
            collapsed={collapsed}
            toggle={toggle}
          />
        ))}
      </ul>
    </div>
  );
}

function NodeRow({
  node,
  library,
  collapsed,
  toggle,
}: {
  node: TreeNode<CurriculumNode>;
  library: LibraryChoice;
  collapsed: Set<string>;
  toggle: (id: string) => void;
}) {
  const open = !collapsed.has(node.id);
  const isSkill = node.level === 'SKILL';
  return (
    <li>
      <div className={`node ${node.status !== 'ACTIVE' ? 'muted' : ''}`}>
        {node.children.length > 0 ? (
          <button
            type="button"
            className="link toggle"
            aria-expanded={open}
            onClick={() => toggle(node.id)}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="toggle" />
        )}
        <span className="badge">{node.level}</span>
        <code>{node.code}</code> {node.title}
        {node.status !== 'ACTIVE' && <span className="warn"> · {node.status}</span>}
        {isSkill && (
          <>
            {' '}
            <span className={node.active ? 'ok' : 'warn'}>
              {node.active ? 'active' : 'inactive'}
            </span>{' '}
            <span className="muted">
              {node.items} items, {node.approvedItems} approved
            </span>{' '}
            <Link
              to="/content/questions"
              search={{ grade: library.grade, subject: library.subject, skill: node.code }}
            >
              Items →
            </Link>
          </>
        )}
      </div>
      {open && node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <NodeRow
              key={child.id}
              node={child}
              library={library}
              collapsed={collapsed}
              toggle={toggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function Coverage({ library }: { library: LibraryChoice }) {
  const { curriculumVersion: v, grade, subject } = library;
  const coverage = useQuery({
    queryKey: libraryKeys.coverage(v, grade, subject),
    queryFn: () => fetchCoverage(v, grade, subject),
  });
  return (
    <div className="card wide">
      <h2>Coverage</h2>
      {coverage.isPending && <Loading />}
      {coverage.isError && (
        <ErrorBox error={coverage.error} retry={() => void coverage.refetch()} />
      )}
      {coverage.data && (
        <CoverageSummary
          coverage={coverage.data.coverage}
          profile={coverage.data.profile ?? null}
        />
      )}
    </div>
  );
}
