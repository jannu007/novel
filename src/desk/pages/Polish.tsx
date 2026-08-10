import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useWork } from '../useWork';
import { AppBar, TabBar, Sheet, NotFound } from '../components/Chrome';
import { loadUndo, saveUndo, clearUndo, type UndoSnapshot } from '../db';
import type { Chapter } from '../../types';
import {
  PROOF_RULES,
  DEFAULT_ENABLED_RULES,
  DEFAULT_MAX_SENTENCE_LENGTH,
  proofreadText,
  decorateIssues,
  applyFixes,
  analyzeQuality,
  detectVariantGroups,
  unifyVariant,
  type ProofIssue,
  type Severity,
  type VariantGroup,
} from '../../lib/proofreader';

const SETTINGS_KEY = 'fuzukue:proof';
const MAX_SHOWN = 200;

const SEVERITY_LABEL: Record<Severity, string> = {
  error: '要修正',
  warning: '要確認',
  info: '提案',
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { enabled?: string[]; max?: number };
      if (Array.isArray(p.enabled)) {
        return {
          enabled: p.enabled,
          max: typeof p.max === 'number' ? p.max : DEFAULT_MAX_SENTENCE_LENGTH,
        };
      }
    }
  } catch {
    // 壊れていたら初期値に戻す
  }
  return { enabled: [...DEFAULT_ENABLED_RULES], max: DEFAULT_MAX_SENTENCE_LENGTH };
}

export default function Polish() {
  const { id } = useParams();
  const { work, update } = useWork(id);
  const initial = useMemo(loadSettings, []);
  const [enabled, setEnabled] = useState<Set<string>>(new Set(initial.enabled));
  const [maxLen, setMaxLen] = useState(initial.max);
  const [scope, setScope] = useState('all');
  const [filter, setFilter] = useState('all');
  const [showRules, setShowRules] = useState(false);
  const [undoSnap, setUndoSnap] = useState<UndoSnapshot | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ enabled: [...enabled], max: maxLen }));
  }, [enabled, maxLen]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    loadUndo(id).then((s) => !cancelled && setUndoSnap(s ?? null));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const chapters = useMemo(
    () => (work ? [...work.chapters].sort((a, b) => a.order - b.order) : []),
    [work]
  );
  const targets = useMemo(
    () => (scope === 'all' ? chapters : chapters.filter((c) => c.id === scope)),
    [chapters, scope]
  );
  const options = useMemo(
    () => ({ enabled, maxSentenceLength: maxLen }),
    [enabled, maxLen]
  );

  const issues = useMemo(
    () =>
      targets.flatMap((c) =>
        decorateIssues(
          proofreadText(c.content, options),
          c.content,
          c.id,
          c.title || `第${chapters.indexOf(c) + 1}章`
        )
      ),
    [targets, chapters, options]
  );

  const metrics = useMemo(
    () => analyzeQuality(targets.map((c) => c.content), maxLen),
    [targets, maxLen]
  );

  const variants = useMemo(
    () => detectVariantGroups(targets.map((c) => c.content)),
    [targets]
  );

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of issues) m.set(i.ruleId, (m.get(i.ruleId) ?? 0) + 1);
    return m;
  }, [issues]);

  const shown = filter === 'all' ? issues : issues.filter((i) => i.ruleId === filter);
  const fixable = issues.filter((i) => i.replacement !== undefined).length;

  if (work === undefined) return <div className="body muted">読み込み中…</div>;
  if (work === null) return <NotFound />;

  function remember(chaptersBefore: Chapter[], label: string) {
    if (!work) return;
    const snap: UndoSnapshot = { chapters: chaptersBefore, label, at: Date.now() };
    setUndoSnap(snap);
    void saveUndo(work.id, snap);
  }

  /**
   * 章の書き換えをまとめて行う。書き換えの計算は更新関数の外で終わらせ、
   * `update` には出来上がった結果だけを渡す（更新関数は再実行されうるため）。
   */
  function rewrite(
    transform: (c: Chapter) => string,
    describe: (changed: number) => string,
    label: string
  ) {
    if (!work) return;
    const before = work.chapters;
    let changed = 0;
    const next = work.chapters.map((c) => {
      if (scope !== 'all' && c.id !== scope) return c;
      const text = transform(c);
      if (text === c.content) return c;
      changed++;
      return { ...c, content: text, updatedAt: Date.now() };
    });
    if (changed > 0) {
      update((w) => ({ ...w, chapters: next }));
      remember(before, label);
    }
    setNotice(describe(changed));
  }

  function fixAll() {
    let applied = 0;
    rewrite(
      (c) => {
        const r = applyFixes(c.content, proofreadText(c.content, options));
        applied += r.applied;
        return r.text;
      },
      () =>
        applied > 0
          ? `${applied}件を直しました。意図と違うところがあれば「元に戻す」で取り消せます。`
          : '自動で直せる指摘はありませんでした。',
      '自動修正'
    );
  }

  function fixOne(issue: ProofIssue) {
    if (!work) return;
    const before = work.chapters;
    const next = work.chapters.map((c) =>
      c.id === issue.chapterId
        ? { ...c, content: applyFixes(c.content, [issue]).text, updatedAt: Date.now() }
        : c
    );
    update((w) => ({ ...w, chapters: next }));
    remember(before, `${issue.ruleLabel}の修正`);
    setNotice('1件を直しました。');
  }

  function unify(group: VariantGroup, chosen: string) {
    rewrite(
      (c) => unifyVariant(c.content, group, chosen),
      (changed) =>
        changed > 0 ? `「${chosen}」にそろえました。` : '変更はありませんでした。',
      `「${chosen}」にそろえる`
    );
  }

  function undo() {
    if (!undoSnap || !work) return;
    const restored = undoSnap.chapters;
    update((w) => ({ ...w, chapters: restored }));
    void clearUndo(work.id);
    setNotice(`「${undoSnap.label}」を元に戻しました。`);
    setUndoSnap(null);
  }

  return (
    <div className="screen">
      <AppBar
        title="推敲"
        sub={work.title || '無題'}
        back="/"
        actions={
          <button className="btn btn-sm" onClick={() => setShowRules(true)}>
            項目
          </button>
        }
      />
      <div className="body">
        <p className="muted" style={{ marginTop: 0 }}>
          通信はせず、この端末の中だけで原稿を点検します。機械的な判定なので、
          直したあとは必ず読み返してください。
        </p>

        <select
          className="input"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          style={{ marginBottom: 14 }}
        >
          <option value="all">作品全体</option>
          {chapters.map((c, i) => (
            <option key={c.id} value={c.id}>
              {c.title || `第${i + 1}章`}
            </option>
          ))}
        </select>

        {/* 文体の目安 */}
        <div className="card">
          <div className="score">
            <div className="dial">
              <b>{metrics.score}</b>
            </div>
            <div>
              <div style={{ fontWeight: 600 }}>読みやすさの目安</div>
              <div className="muted">
                {metrics.chars.toLocaleString()}字・{metrics.sentences.toLocaleString()}文・
                {metrics.paragraphs.toLocaleString()}段落
              </div>
            </div>
          </div>
          <ul className="metrics">
            {metrics.rows.map((r) => (
              <li key={r.key} className={`metric ${r.status === 'warn' ? 'off' : ''}`}>
                <b>{r.label}</b>
                <span className="val">{r.display}</span>
                <span className="note">
                  目安 {r.idealText}／{r.hint}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="row" style={{ margin: '14px 0' }}>
          <button className="btn btn-seal" onClick={fixAll} disabled={fixable === 0}>
            {fixable}件をまとめて直す
          </button>
          <button className="btn" onClick={undo} disabled={!undoSnap}>
            元に戻す
          </button>
        </div>

        {notice && <p className="notice">{notice}</p>}

        {variants.length > 0 && (
          <>
            <div className="section-title">表記ゆれ {variants.length}</div>
            <p className="muted" style={{ marginTop: 0 }}>
              そろえたい表記を選ぶと、対象範囲をまとめて置き換えます。
            </p>
            <div className="stack">
              {variants.map((g) => (
                <div className="variant" key={g.forms.map((f) => f.form).join('|')}>
                  {g.forms.map((f) => (
                    <button
                      key={f.form}
                      className="btn btn-sm"
                      onClick={() => unify(g, f.form)}
                    >
                      {f.form}
                      <span className="muted" style={{ fontSize: 11 }}>
                        {f.count}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="section-title">指摘 {issues.length}</div>
        {issues.length === 0 ? (
          <div className="empty">
            <span className="mark">整</span>
            指摘はありません。
          </div>
        ) : (
          <>
            <div className="chips">
              <button
                className={`chip ${filter === 'all' ? 'on' : ''}`}
                onClick={() => setFilter('all')}
              >
                すべて {issues.length}
              </button>
              {PROOF_RULES.filter((r) => counts.has(r.id)).map((r) => (
                <button
                  key={r.id}
                  className={`chip ${filter === r.id ? 'on' : ''}`}
                  onClick={() => setFilter(r.id)}
                >
                  {r.label} {counts.get(r.id)}
                </button>
              ))}
            </div>
            <ul className="issues">
              {shown.slice(0, MAX_SHOWN).map((issue, i) => (
                <li className="issue" key={`${issue.chapterId}-${issue.index}-${i}`}>
                  <div className="top">
                    <span className={`tag ${issue.severity}`}>
                      {SEVERITY_LABEL[issue.severity]}
                    </span>
                    <b style={{ color: 'var(--ink)' }}>{issue.ruleLabel}</b>
                    <span>
                      {issue.chapterTitle}・{issue.line}行目
                    </span>
                    <div className="spacer" />
                    {issue.replacement !== undefined && (
                      <button className="btn btn-sm" onClick={() => fixOne(issue)}>
                        直す
                      </button>
                    )}
                    <Link className="btn btn-sm btn-quiet" to={`/w/${work.id}`}>
                      本文へ
                    </Link>
                  </div>
                  <div className="quote">
                    <span className="dim">{issue.before}</span>
                    <em>{issue.target || '␣'}</em>
                    <span className="dim">{issue.after}</span>
                  </div>
                  <p className="why">{issue.message}</p>
                </li>
              ))}
            </ul>
            {shown.length > MAX_SHOWN && (
              <p className="muted">
                残り{shown.length - MAX_SHOWN}件は省略しています。修正を反映するか、
                章や項目で絞り込んでください。
              </p>
            )}
          </>
        )}
      </div>

      {showRules && (
        <Sheet title="点検する項目" onClose={() => setShowRules(false)}>
          <label className="field">
            <span>「一文が長い」と判断する文字数</span>
            <input
              className="input"
              type="number"
              min={20}
              max={200}
              value={maxLen}
              onChange={(e) =>
                setMaxLen(Math.min(200, Math.max(20, Number(e.target.value) || 20)))
              }
            />
          </label>
          {PROOF_RULES.map((r) => (
            <label className="rule" key={r.id}>
              <input
                type="checkbox"
                checked={enabled.has(r.id)}
                onChange={() =>
                  setEnabled((prev) => {
                    const next = new Set(prev);
                    if (next.has(r.id)) next.delete(r.id);
                    else next.add(r.id);
                    return next;
                  })
                }
              />
              <span>
                <b>{r.label}</b>
                <span className={`tag ${r.severity}`} style={{ marginLeft: 6 }}>
                  {SEVERITY_LABEL[r.severity]}
                </span>
                <br />
                <span className="muted">{r.description}</span>
              </span>
            </label>
          ))}
        </Sheet>
      )}

      <TabBar workId={work.id} />
    </div>
  );
}
