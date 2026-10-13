// Shared pieces of the library screens (M05).
import { useQuery } from '@tanstack/react-query';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { hasAnyAdminPermission, type AdminAccess } from '../access.ts';
import { speechLang } from './edit.ts';
import { splitMath } from './math.ts';
import { fetchOverview, libraryKeys } from './queries.ts';
import type { LibraryChoice } from './choices.ts';
import type { CoverageReport, MediaAsset, SubjectProfile } from './types.ts';
import { percent } from './upload.ts';

export const AccessContext = createContext<AdminAccess>({ kind: 'signed-out' });

/** True when the signed-in admin holds one of `permissions` (SUPER_ADMIN implies all). */
export function useCan(permissions: readonly string[]): boolean {
  return hasAnyAdminPermission(useContext(AccessContext), permissions);
}

export const Loading = ({ what = 'Loading' }: { what?: string }) => (
  <p className="muted" role="status">
    {what}…
  </p>
);

export function ErrorBox({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <p className="error" role="alert">
      {error.message}{' '}
      {retry && (
        <button type="button" className="secondary" onClick={retry}>
          Retry
        </button>
      )}
    </p>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="card empty">
    <p>{children}</p>
  </div>
);

export const StatusBadge = ({ status }: { status: string }) => (
  <span className={`badge status-${status.toLowerCase()}`}>{status}</span>
);

/** Markdown-ish preview: line breaks, **bold**, `$…$` inline and `$$…$$` display KaTeX. */
export function RichText({ text }: { text: string }) {
  const segments = useMemo(() => splitMath(text), [text]);
  return (
    <div className="rich">
      {segments.map((seg, i) =>
        seg.kind === 'math' ? (
          <span
            key={i}
            className={seg.display ? 'math-display' : 'math'}
            // KaTeX output with trust:false contains no scripts or links.
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(seg.tex, {
                displayMode: seg.display,
                throwOnError: false,
                trust: false,
              }),
            }}
          />
        ) : (
          seg.text
            .split(/(\*\*[^*]+\*\*)/)
            .map((part, j) =>
              part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
                <strong key={`${i}-${j}`}>{part.slice(2, -2)}</strong>
              ) : (
                part
              ),
            )
        ),
      )}
    </div>
  );
}

const speechSupported = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window;

/** TTS preview through the browser's speech synthesis (no AI call). */
export function SpeakButton({ text, lang }: { text: string; lang: 'vi' | 'en' | null }) {
  if (!speechSupported()) return <span className="muted">Speech preview not supported here.</span>;
  const speak = () => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLang(lang);
    window.speechSynthesis.speak(utterance);
  };
  return (
    <span className="actions">
      <button type="button" className="secondary" disabled={!text.trim()} onClick={speak}>
        ▶ Play ({speechLang(lang)})
      </button>
      <button type="button" className="secondary" onClick={() => window.speechSynthesis.cancel()}>
        ■ Stop
      </button>
    </span>
  );
}

/** Inline SVG media (sanitised on import) shown as an image, never as live markup. */
export function MediaPreview({ media }: { media: MediaAsset[] }) {
  if (media.length === 0) return <p className="muted">No media.</p>;
  return (
    <div className="media-grid">
      {media.map((m) => (
        <figure key={m.id}>
          {m.inlineSvg ? (
            <img src={`data:image/svg+xml;utf8,${encodeURIComponent(m.inlineSvg)}`} alt={m.alt} />
          ) : (
            <div className="muted">{m.storagePath ?? 'No preview'}</div>
          )}
          <figcaption>
            <code>{m.code}</code> · {m.kind} · <StatusBadge status={m.reviewStatus} />
            <br />
            <span className="muted">
              {m.alt} — {m.license}
              {m.attribution ? `, ${m.attribution}` : ''}
            </span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export function useOverview() {
  return useQuery({ queryKey: libraryKeys.overview, queryFn: fetchOverview });
}

/** Grade-subject selector; `allowAll` adds an "All libraries" entry (value ''). */
export function LibrarySelect({
  choices,
  value,
  onChange,
  allowAll = false,
}: {
  choices: LibraryChoice[];
  value: string;
  onChange: (choice: LibraryChoice | null) => void;
  allowAll?: boolean;
}) {
  return (
    <label>
      Library
      <select
        value={value}
        onChange={(e) => onChange(choices.find((c) => c.key === e.target.value) ?? null)}
      >
        {allowAll && <option value="">All libraries</option>}
        {choices.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const SHARES = [
  ['TEMPLATE share', 'templateShare'],
  ['Group share', 'groupShare'],
  ['Written share', 'writtenShare'],
] as const;

/** Coverage report against the subject profile (counts, shares, flags, per-skill table). */
export function CoverageSummary({
  coverage,
  profile,
}: {
  coverage: CoverageReport;
  profile: SubjectProfile | null;
}) {
  const types = Object.entries(coverage.perType);
  return (
    <div className="coverage">
      <p>
        <strong>{coverage.totalItems}</strong> of {coverage.targetItems} items ·{' '}
        {coverage.approvedItems} approved · {coverage.perSkill.length} skills,{' '}
        {coverage.inactiveSkills.length} inactive
      </p>
      {coverage.flags.length > 0 ? (
        <ul className="warn">
          {coverage.flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : (
        <p className="ok">No coverage flags.</p>
      )}
      <table>
        <thead>
          <tr>
            <th>Share</th>
            <th>Actual</th>
            <th>Profile</th>
          </tr>
        </thead>
        <tbody>
          {SHARES.map(([label, key]) => (
            <tr key={key}>
              <td>{label}</td>
              <td>{percent(coverage[key])}</td>
              <td className="muted">{profile ? percent(profile[key]) : '—'}</td>
            </tr>
          ))}
          <tr>
            <td>Read-aloud share</td>
            <td>{percent(coverage.readAloudShare)}</td>
            <td className="muted">
              {profile ? (profile.readAloudDefault ? 'all' : 'optional') : '—'}
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Levels:{' '}
        {Object.entries(coverage.perLevel)
          .map(([level, n]) => `${level} ${n}`)
          .join(' · ')}
      </p>
      {types.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Items</th>
              <th>Share</th>
              <th>Profile mix</th>
            </tr>
          </thead>
          <tbody>
            {types.map(([type, n]) => (
              <tr key={type}>
                <td>{type}</td>
                <td>{n}</td>
                <td>{coverage.totalItems ? percent(n / coverage.totalItems) : '—'}</td>
                <td className="muted">
                  {profile?.itemTypeMix[type] !== undefined
                    ? percent(profile.itemTypeMix[type])
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {coverage.perSkill.length > 0 && (
        <details>
          <summary>Per skill ({coverage.perSkill.length})</summary>
          <table>
            <thead>
              <tr>
                <th>Skill</th>
                <th>Items</th>
                <th>Approved</th>
                <th>L1–L5</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {coverage.perSkill.map((s) => (
                <tr key={s.code}>
                  <td>
                    <code>{s.code}</code> {s.title}
                  </td>
                  <td>{s.items}</td>
                  <td>{s.approved}</td>
                  <td>{Object.values(s.byLevel).join(' / ')}</td>
                  <td>
                    <span className={s.active ? 'ok' : 'warn'}>
                      {s.active ? 'active' : 'inactive'}
                    </span>
                    {!s.levelSpread && <span className="warn"> · no level spread</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
