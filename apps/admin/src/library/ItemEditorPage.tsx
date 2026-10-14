// Item editor: content fields, live KaTeX preview, media and TTS preview, template variant re-roll.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import {
  changedFields,
  nullIfBlank,
  parseJsonField,
  randomSeed,
  toJsonText,
  type JsonField,
} from './edit.ts';
import { fetchItem, fetchVariant, libraryKeys, patchItem } from './queries.ts';
import {
  COGNITIVE_LEVELS,
  CONTENT_STATUSES,
  LIBRARY_EDIT,
  type CognitiveLevel,
  type ContentStatus,
  type ItemDetail,
  type ItemPatch,
} from './types.ts';
import {
  ErrorBox,
  Loading,
  MediaPreview,
  RichText,
  SpeakButton,
  StatusBadge,
  useCan,
} from './ui.tsx';

export function ItemEditorPage({ id }: { id: string }) {
  const item = useQuery({ queryKey: libraryKeys.item(id), queryFn: () => fetchItem(id) });
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <section className="library">
      <p>
        <Link to="/content/questions">← Questions</Link>
      </p>
      {item.isPending && <Loading what="Loading item" />}
      {item.isError && <ErrorBox error={item.error} retry={() => void item.refetch()} />}
      {item.data && (
        <ItemForm
          key={`${item.data.id}:${item.data.version}`}
          item={item.data}
          notice={notice}
          setNotice={setNotice}
          reload={() => void item.refetch()}
        />
      )}
    </section>
  );
}

const JSON_FIELDS = [
  'options',
  'answer',
  'hints',
  'distractorFeedback',
  'rubric',
  'misconceptionTags',
  'template',
] as const;
type JsonFieldName = (typeof JSON_FIELDS)[number];

/** The template as PATCH accepts it (without the flag bookkeeping). */
function editableTemplate(item: ItemDetail): unknown {
  const template = item.template as (ItemDetail['template'] & object) | null;
  if (!template) return null;
  const { flaggedAt: _f, flagReason: _r, ...rest } = template;
  return rest;
}

function ItemForm({
  item,
  notice,
  setNotice,
  reload,
}: {
  item: ItemDetail;
  notice: string | null;
  setNotice: (notice: string | null) => void;
  reload: () => void;
}) {
  const canEdit = useCan(LIBRARY_EDIT);
  const queryClient = useQueryClient();
  const isTemplate = item.kind === 'TEMPLATE';
  const template = item.template as (ItemDetail['template'] & object) | null;

  const [stemMd, setStemMd] = useState(item.stemMd);
  const [explanationMd, setExplanationMd] = useState(item.explanationMd);
  const [workedSolutionMd, setWorkedSolutionMd] = useState(item.workedSolutionMd);
  const [ttsText, setTtsText] = useState(item.ttsText ?? '');
  const [ttsLang, setTtsLang] = useState<'' | 'vi' | 'en'>(item.ttsLang ?? '');
  const [difficulty, setDifficulty] = useState(item.difficulty);
  const [cognitiveLevel, setCognitiveLevel] = useState<CognitiveLevel>(item.cognitiveLevel);
  const [status, setStatus] = useState<ContentStatus>(item.status);
  const [json, setJson] = useState<Record<JsonFieldName, string>>(() => ({
    options: toJsonText(item.options),
    answer: toJsonText(item.answer),
    hints: toJsonText(item.hints),
    distractorFeedback: toJsonText(item.distractorFeedback),
    rubric: toJsonText(item.rubric),
    misconceptionTags: toJsonText(item.misconceptionTags),
    template: toJsonText(editableTemplate(item)),
  }));
  const parsed = Object.fromEntries(
    JSON_FIELDS.map((name) => [name, parseJsonField(json[name])]),
  ) as Record<JsonFieldName, JsonField>;
  const value = (name: JsonFieldName): unknown => {
    const field = parsed[name];
    return field.ok ? field.value : undefined;
  };
  const jsonInvalid = JSON_FIELDS.some(
    (name) => !parsed[name].ok && (name !== 'template' || isTemplate),
  );

  const original = {
    stemMd: item.stemMd,
    explanationMd: item.explanationMd,
    workedSolutionMd: item.workedSolutionMd,
    ttsText: item.ttsText,
    ttsLang: item.ttsLang,
    difficulty: item.difficulty,
    cognitiveLevel: item.cognitiveLevel,
    status: item.status,
    options: item.options as unknown,
    answer: item.answer as unknown,
    hints: item.hints as unknown,
    distractorFeedback: item.distractorFeedback as unknown,
    rubric: item.rubric as unknown,
    misconceptionTags: item.misconceptionTags as unknown,
    ...(isTemplate ? { template: editableTemplate(item) } : {}),
  };
  const draft = {
    stemMd,
    explanationMd,
    workedSolutionMd,
    ttsText: nullIfBlank(ttsText),
    ttsLang: ttsLang || null,
    difficulty,
    cognitiveLevel,
    status,
    ...Object.fromEntries(
      JSON_FIELDS.filter((n) => n !== 'template' || isTemplate).map((n) => [n, value(n)]),
    ),
  };
  const changes = jsonInvalid ? {} : changedFields(original, draft);
  const dirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: () => patchItem(item.id, { version: item.version, ...changes } as ItemPatch),
    onSuccess: async (updated) => {
      setNotice(`Saved ${Object.keys(changes).join(', ')} (version ${updated.version}).`);
      queryClient.setQueryData(libraryKeys.item(item.id), updated);
      await queryClient.invalidateQueries({ queryKey: libraryKeys.all });
    },
  });

  const jsonArea = (name: JsonFieldName, label: string, rows = 6) => (
    <label key={name}>
      {label} <span className="muted">(JSON)</span>
      <textarea
        className="code"
        rows={rows}
        readOnly={!canEdit}
        value={json[name]}
        onChange={(e) => setJson((prev) => ({ ...prev, [name]: e.target.value }))}
        aria-invalid={!parsed[name].ok}
      />
      {!parsed[name].ok && (
        <span className="error">{(parsed[name] as { error: string }).error}</span>
      )}
    </label>
  );

  const speakText = ttsText.trim() || stemMd;
  const options = Array.isArray(value('options'))
    ? (value('options') as ItemDetail['options'])
    : [];

  return (
    <>
      <h1>
        <code>{item.code}</code> <StatusBadge status={item.status} />
      </h1>
      <p className="muted">
        Lớp {item.grade} · {item.subject} · {item.kind} · {item.type} · version {item.version} ·
        updated {new Date(item.updatedAt).toLocaleString('vi-VN')}
      </p>
      <p>
        Skills:{' '}
        {item.skills.length === 0
          ? '—'
          : item.skills.map((s) => (
              <span key={s.id} className="chip">
                <Link
                  to="/content/questions"
                  search={{ grade: item.grade, subject: item.subject, skill: s.code }}
                >
                  {s.code}
                </Link>{' '}
                {s.title}
              </span>
            ))}
      </p>
      {item.group && (
        <p>
          Group:{' '}
          <Link to="/content/groups/$id" params={{ id: item.group.id }}>
            {item.group.title}
          </Link>{' '}
          <span className="muted">
            ({item.group.stimulusKind}, position {item.groupOrder ?? '—'})
          </span>
        </p>
      )}
      {template?.flaggedAt && (
        <p className="error">
          Template flagged {new Date(template.flaggedAt).toLocaleString('vi-VN')}:{' '}
          {template.flagReason}
        </p>
      )}
      {!canEdit && (
        <p className="warn">Read only: editing needs CONTENT_ADMIN or CONTENT_REVIEWER.</p>
      )}

      <div className="editor">
        <form
          className="card fields"
          onSubmit={(e) => {
            e.preventDefault();
            if (canEdit && dirty) save.mutate();
          }}
        >
          <label>
            Stem
            <textarea
              rows={4}
              readOnly={!canEdit}
              value={stemMd}
              onChange={(e) => setStemMd(e.target.value)}
            />
          </label>
          {jsonArea('options', 'Options', 8)}
          {jsonArea('answer', 'Answer', 3)}
          <label>
            Explanation
            <textarea
              rows={3}
              readOnly={!canEdit}
              value={explanationMd}
              onChange={(e) => setExplanationMd(e.target.value)}
            />
          </label>
          <label>
            Worked solution
            <textarea
              rows={4}
              readOnly={!canEdit}
              value={workedSolutionMd}
              onChange={(e) => setWorkedSolutionMd(e.target.value)}
            />
          </label>
          {jsonArea('hints', 'Hints (exactly 4)', 8)}
          {jsonArea('distractorFeedback', 'Distractor feedback', 5)}
          {jsonArea('misconceptionTags', 'Misconception tags', 2)}
          {jsonArea('rubric', 'Rubric (written items only, else null)', 4)}
          {isTemplate && jsonArea('template', 'Template', 12)}
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
              Difficulty
              <select
                disabled={!canEdit}
                value={difficulty}
                onChange={(e) => setDifficulty(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Level
              <select
                disabled={!canEdit}
                value={cognitiveLevel}
                onChange={(e) => setCognitiveLevel(e.target.value as CognitiveLevel)}
              >
                {COGNITIVE_LEVELS.map((l) => (
                  <option key={l}>{l}</option>
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
          {canEdit && (
            <div className="actions">
              <button type="submit" disabled={!dirty || jsonInvalid || save.isPending}>
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
              <span className="muted">
                {jsonInvalid
                  ? 'Fix the JSON errors to save.'
                  : dirty
                    ? `Changed: ${Object.keys(changes).join(', ')}`
                    : 'No changes.'}
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
          <h2>Preview</h2>
          <RichText text={stemMd} />
          {options.length > 0 && (
            <ol className="options">
              {options.map((o) => (
                <li key={o.id}>
                  <code>{o.id}</code> <RichText text={o.text ?? ''} />
                  {o.media && <span className="muted"> [media {o.media}]</span>}
                  {o.side && <span className="muted"> ({o.side})</span>}
                </li>
              ))}
            </ol>
          )}
          <h3>Explanation</h3>
          <RichText text={explanationMd} />
          <h3>Worked solution</h3>
          <RichText text={workedSolutionMd} />
          <h3>Hints</h3>
          {Array.isArray(value('hints')) ? (
            <ol>
              {(value('hints') as { md?: string }[]).map((h, i) => (
                <li key={i}>
                  <RichText text={h.md ?? ''} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">—</p>
          )}
          <h3>Speech</h3>
          <p className="muted">{ttsText.trim() ? 'TTS text' : 'No TTS text; reads the stem'}</p>
          <SpeakButton text={speakText} lang={ttsLang || null} />
          <h3>Media</h3>
          <MediaPreview media={item.media} />
          {isTemplate && <VariantPanel itemId={item.id} version={item.version} />}
        </div>
      </div>
    </>
  );
}

function VariantPanel({ itemId, version }: { itemId: string; version: number }) {
  const [seedInput, setSeedInput] = useState('1');
  const [seed, setSeed] = useState<number | null>(null);
  const variant = useQuery({
    queryKey: [...libraryKeys.item(itemId), 'variant', version, seed],
    queryFn: () => fetchVariant(itemId, seed!),
    enabled: seed !== null,
    retry: false,
  });
  const reroll = () => {
    const next = randomSeed();
    setSeedInput(String(next));
    setSeed(next);
  };
  const render = () => {
    const n = Number(seedInput);
    if (Number.isInteger(n) && n >= 0 && n <= 0xffff_ffff) setSeed(n);
  };

  return (
    <>
      <h3>Template variant</h3>
      <p className="muted">Renders the saved template (save edits first).</p>
      <div className="actions">
        <label>
          Seed{' '}
          <input
            type="number"
            min={0}
            max={4294967295}
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
          />
        </label>
        <button type="button" className="secondary" onClick={render}>
          Render
        </button>
        <button type="button" onClick={reroll}>
          Re-roll
        </button>
      </div>
      {seed !== null && variant.isPending && <Loading what="Rendering" />}
      {variant.isError && <ErrorBox error={variant.error} />}
      {variant.data && (
        <div className="variant">
          <p className="muted">Seed {variant.data.seed}</p>
          <RichText text={variant.data.stemMd} />
          {variant.data.options.length > 0 && (
            <ol className="options">
              {variant.data.options.map((o) => (
                <li key={o.id}>
                  <code>{o.id}</code> <RichText text={o.text ?? ''} />
                </li>
              ))}
            </ol>
          )}
          <p>
            Answer: <code>{JSON.stringify(variant.data.answer)}</code>
          </p>
          <p className="muted">
            Params: <code>{JSON.stringify(variant.data.params)}</code>
          </p>
          {variant.data.explanationMd && <RichText text={variant.data.explanationMd} />}
        </div>
      )}
    </>
  );
}
