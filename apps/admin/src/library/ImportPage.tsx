// Library packages: upload a package zip → dry-run diff → apply; recent import runs.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { fetchImports, libraryKeys } from './queries.ts';
import { LIBRARY_IMPORT, type ImportResult, type PackageIssue } from './types.ts';
import { CoverageSummary, ErrorBox, Loading, useCan, useOverview } from './ui.tsx';
import { checkPackageFile, diffRows, importPackage, type ImportOutcome } from './upload.ts';

export function ImportPage() {
  const canImport = useCan(LIBRARY_IMPORT);
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState<ImportOutcome | null>(null);
  const [applied, setApplied] = useState<ImportOutcome | null>(null);
  const [busy, setBusy] = useState<'dry-run' | 'apply' | null>(null);

  const pick = (picked: File | null) => {
    setFile(picked);
    setDryRun(null);
    setApplied(null);
    setFileError(picked ? checkPackageFile(picked) : null);
  };

  const run = async (mode: 'dry-run' | 'apply') => {
    if (!file) return;
    setBusy(mode);
    try {
      const outcome = await importPackage(api, file, mode).catch((e: Error): ImportOutcome => ({
        kind: 'error',
        message: e.message,
      }));
      if (mode === 'dry-run') {
        setDryRun(outcome);
        setApplied(null);
      } else {
        setApplied(outcome);
      }
      await queryClient.invalidateQueries({ queryKey: libraryKeys.all });
    } finally {
      setBusy(null);
    }
  };

  const ready = file !== null && fileError === null;
  const dryOk = dryRun?.kind === 'ok' ? dryRun.result : null;

  return (
    <section className="library">
      <h1>Library packages</h1>
      <div className="card wide">
        <h2>Import a package</h2>
        <p className="muted">
          A package is the zip of{' '}
          <code>library/&lt;version&gt;/&lt;grade&gt;-&lt;subject&gt;/</code>. Run a dry-run first:
          it validates the package and shows what would change. Apply writes everything in one
          transaction; entities missing from the package are archived, never deleted.
        </p>
        {!canImport && (
          <p className="warn">Importing needs the CONTENT_ADMIN permission; you can view runs.</p>
        )}
        <div className="actions">
          <input
            type="file"
            accept=".zip,application/zip"
            disabled={!canImport || busy !== null}
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            disabled={!canImport || !ready || busy !== null}
            onClick={() => void run('dry-run')}
          >
            {busy === 'dry-run' ? 'Checking…' : 'Dry-run'}
          </button>
          <button
            type="button"
            disabled={!canImport || !dryOk || dryOk.noop || busy !== null || applied !== null}
            onClick={() => void run('apply')}
          >
            {busy === 'apply' ? 'Applying…' : 'Apply'}
          </button>
        </div>
        {fileError && <p className="error">{fileError}</p>}
        {dryOk?.noop && !applied && (
          <p className="ok">Nothing to apply: the library already matches this package.</p>
        )}
      </div>

      {applied && (
        <div className="card wide">
          <h2>Apply result</h2>
          <Outcome outcome={applied} />
        </div>
      )}
      {dryRun && (
        <div className="card wide">
          <h2>Dry-run</h2>
          <Outcome outcome={dryRun} />
        </div>
      )}

      <div className="card wide">
        <h2>Recent imports</h2>
        <RecentRuns />
      </div>
    </section>
  );
}

function Outcome({ outcome }: { outcome: ImportOutcome }) {
  if (outcome.kind === 'error') return <p className="error">{outcome.message}</p>;
  if (outcome.kind === 'invalid') {
    return (
      <>
        <p className="error">
          The package is invalid ({outcome.errors.length} error
          {outcome.errors.length === 1 ? '' : 's'}). Fix it and run the dry-run again.
        </p>
        <IssueList issues={outcome.errors} className="error" />
        {outcome.warnings.length > 0 && (
          <>
            <h3>Warnings</h3>
            <IssueList issues={outcome.warnings} className="warn" />
          </>
        )}
      </>
    );
  }
  return <ResultView result={outcome.result} />;
}

function IssueList({ issues, className }: { issues: PackageIssue[]; className: string }) {
  if (issues.length === 0) return <p className="muted">None.</p>;
  return (
    <table className="issues">
      <thead>
        <tr>
          <th>Code</th>
          <th>Problem</th>
          <th>Where</th>
        </tr>
      </thead>
      <tbody>
        {issues.map((issue, i) => (
          <tr key={i}>
            <td className={className}>
              <code>{issue.code}</code>
            </td>
            <td>{issue.message}</td>
            <td className="muted">{issue.ref ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CodeList({ codes }: { codes: string[] }) {
  if (codes.length === 0) return <>0</>;
  return (
    <details>
      <summary>{codes.length}</summary>
      <ul className="codes">
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
    </details>
  );
}

function ResultView({ result }: { result: ImportResult }) {
  const { rows, changes } = diffRows(result.diff);
  const pkg = result.package;
  const profile =
    useOverview().data?.profiles.find((p) => p.grade === pkg.grade && p.subject === pkg.subject) ??
    null;
  return (
    <>
      <p>
        <strong>{pkg.title}</strong> · {pkg.curriculumVersion} · Lớp {pkg.grade} · {pkg.subject}{' '}
        <span className="muted">sha256 {pkg.sha256.slice(0, 12)}…</span>
      </p>
      <p className={result.applied ? 'ok' : 'muted'}>
        {result.applied
          ? `Applied ${changes} change${changes === 1 ? '' : 's'}.`
          : result.noop
            ? 'No changes: re-importing this package is a no-op.'
            : `${changes} change${changes === 1 ? '' : 's'} would be applied.`}
      </p>
      <table>
        <thead>
          <tr>
            <th>Entity</th>
            <th>Added</th>
            <th>Updated</th>
            <th>Archived</th>
            <th>Restored</th>
            <th>Unchanged</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.entity}>
              <td>{row.entity}</td>
              <td>
                <CodeList codes={row.added} />
              </td>
              <td>
                <CodeList codes={row.updated} />
              </td>
              <td className={row.archived.length ? 'warn' : ''}>
                <CodeList codes={row.archived} />
              </td>
              <td>
                <CodeList codes={row.restored} />
              </td>
              <td className="muted">{row.unchanged}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Warnings</h3>
      <IssueList issues={result.warnings} className="warn" />
      <h3>Coverage after import</h3>
      <CoverageSummary coverage={result.coverage} profile={profile} />
    </>
  );
}

function RecentRuns() {
  const runs = useQuery({ queryKey: libraryKeys.imports, queryFn: fetchImports });
  if (runs.isPending) return <Loading />;
  if (runs.isError) return <ErrorBox error={runs.error} retry={() => void runs.refetch()} />;
  if (runs.data.length === 0) return <p className="empty">No package has been imported yet.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>When</th>
          <th>Mode</th>
          <th>Package</th>
          <th>Result</th>
          <th>sha256</th>
        </tr>
      </thead>
      <tbody>
        {runs.data.map((run) => (
          <tr key={run.id}>
            <td>{new Date(run.createdAt).toLocaleString('vi-VN')}</td>
            <td>{run.mode === 'APPLY' ? 'Apply' : 'Dry-run'}</td>
            <td>
              {run.title}{' '}
              <span className="muted">
                ({run.curriculumVersion} · {run.grade}-{run.subject})
              </span>
            </td>
            <td className={run.valid ? 'ok' : 'error'}>
              {run.valid ? 'valid' : `${run.errorCount} error${run.errorCount === 1 ? '' : 's'}`}
            </td>
            <td className="muted">
              <code>{run.packageSha256.slice(0, 12)}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
