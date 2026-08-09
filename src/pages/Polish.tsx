import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import TopBar from '../components/TopBar';
import EmptyIllustration from '../components/EmptyIllustration';
import { useNovel } from '../lib/useNovel';
import {
  loadUndoSnapshot,
  saveUndoSnapshot,
  clearUndoSnapshot,
  type UndoSnapshot,
} from '../db';
import type { Chapter } from '../types';
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
} from '../lib/proofreader';

const SETTINGS_KEY = 'novel-studio:proof-settings';
/** 一覧に描画する指摘の上限（長編でも操作が重くならないようにする） */
const MAX_RENDERED_ISSUES = 300;

interface StoredSettings {
  enabled: string[];
  maxSentenceLength: number;
}

function loadSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredSettings>;
      if (Array.isArray(parsed.enabled)) {
        return {
          enabled: parsed.enabled,
          maxSentenceLength:
            typeof parsed.maxSentenceLength === 'number'
              ? parsed.maxSentenceLength
              : DEFAULT_MAX_SENTENCE_LENGTH,
        };
      }
    }
  } catch {
    // 設定が壊れている場合は初期値に戻す
  }
  return {
    enabled: [...DEFAULT_ENABLED_RULES],
    maxSentenceLength: DEFAULT_MAX_SENTENCE_LENGTH,
  };
}

const SEVERITY_LABEL: Record<Severity, string> = {
  error: '要修正',
  warning: '要確認',
  info: '提案',
};

export default function Polish() {
  const { id } = useParams();
  const { novel, update, saveStatus } = useNovel(id);
  const initial = useMemo(loadSettings, []);
  const [enabled, setEnabled] = useState<Set<string>>(new Set(initial.enabled));
  const [maxSentenceLength, setMaxSentenceLength] = useState(initial.maxSentenceLength);
  const [scope, setScope] = useState('all');
  const [showSettings, setShowSettings] = useState(false);
  const [ruleFilter, setRuleFilter] = useState('all');
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);
  const [notice, setNotice] = useState('');

  // 一括修正の取り消し用のひかえは端末に保存しているため、
  // 画面を移動して戻ってきても取り消せる。
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    loadUndoSnapshot(id).then((snapshot) => {
      if (!cancelled) setUndoSnapshot(snapshot ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ enabled: [...enabled], maxSentenceLength })
    );
  }, [enabled, maxSentenceLength]);

  const chapters = useMemo(
    () => (novel ? [...novel.chapters].sort((a, b) => a.order - b.order) : []),
    [novel]
  );
  const targets = useMemo(
    () => (scope === 'all' ? chapters : chapters.filter((c) => c.id === scope)),
    [chapters, scope]
  );

  const options = useMemo(
    () => ({ enabled, maxSentenceLength }),
    [enabled, maxSentenceLength]
  );

  const issues = useMemo(
    () =>
      targets.flatMap((ch) =>
        decorateIssues(
          proofreadText(ch.content, options),
          ch.content,
          ch.id,
          // 章を絞り込んでいても通し番号がずれないよう、作品全体での位置を使う
          ch.title || `第${chapters.indexOf(ch) + 1}章`
        )
      ),
    [targets, chapters, options]
  );

  const metrics = useMemo(
    () => analyzeQuality(targets.map((c) => c.content), maxSentenceLength),
    [targets, maxSentenceLength]
  );

  const variants = useMemo(
    () => detectVariantGroups(targets.map((c) => c.content)),
    [targets]
  );

  const countsByRule = useMemo(() => {
    const map = new Map<string, number>();
    for (const issue of issues) {
      map.set(issue.ruleId, (map.get(issue.ruleId) ?? 0) + 1);
    }
    return map;
  }, [issues]);

  const visibleIssues = useMemo(
    () => (ruleFilter === 'all' ? issues : issues.filter((i) => i.ruleId === ruleFilter)),
    [issues, ruleFilter]
  );

  const fixableCount = issues.filter((i) => i.replacement !== undefined).length;

  if (novel === undefined) return <div className="page">読み込み中…</div>;
  if (novel === null) {
    return (
      <div className="page">
        <p>作品が見つかりませんでした。</p>
        <Link to="/">ダッシュボードに戻る</Link>
      </div>
    );
  }

  function toggleRule(ruleId: string) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  }

  /**
   * 章の書き換えを1つの操作としてまとめ、直前の状態を元に戻せるようにする。
   * 書き換えの計算は更新関数の外で済ませ、`update` には出来上がった結果だけを
   * 渡している（React の更新関数は再実行されうるため、そこで数を数えたり
   * 本文を組み立てたりしない）。
   */
  function rewriteChapters(
    transform: (chapter: Chapter) => string,
    describe: (changedChapters: number) => string,
    label: string
  ) {
    if (!novel) return;
    const snapshot = novel.chapters;
    let changed = 0;
    const nextChapters = novel.chapters.map((ch) => {
      if (scope !== 'all' && ch.id !== scope) return ch;
      const next = transform(ch);
      if (next === ch.content) return ch;
      changed++;
      return { ...ch, content: next, updatedAt: Date.now() };
    });
    if (changed > 0) {
      update((n) => ({ ...n, chapters: nextChapters }));
      rememberUndo(snapshot, label);
    }
    setNotice(describe(changed));
  }

  function applyAllFixes() {
    let applied = 0;
    rewriteChapters(
      (ch) => {
        const result = applyFixes(ch.content, proofreadText(ch.content, options));
        applied += result.applied;
        return result.text;
      },
      () =>
        applied > 0
          ? `${applied}件を自動修正しました。内容を確認し、意図と違う箇所があれば「元に戻す」で取り消せます。`
          : '自動修正できる指摘はありませんでした。',
      '自動修正'
    );
  }

  function applyOneFix(issue: ProofIssue) {
    if (!novel) return;
    const snapshot = novel.chapters;
    const nextChapters = novel.chapters.map((ch) =>
      ch.id === issue.chapterId
        ? { ...ch, content: applyFixes(ch.content, [issue]).text, updatedAt: Date.now() }
        : ch
    );
    update((n) => ({ ...n, chapters: nextChapters }));
    rememberUndo(snapshot, `${issue.ruleLabel}の修正`);
    setNotice('1件を修正しました。');
  }

  function unify(group: VariantGroup, chosen: string) {
    rewriteChapters(
      (ch) => unifyVariant(ch.content, group, chosen),
      (changed) =>
        changed > 0
          ? `「${chosen}」に統一しました（${changed}つの章を変更）。`
          : '変更はありませんでした。',
      `「${chosen}」に統一`
    );
  }

  /** 直前の状態をひかえとして保存する（1つ前まで戻せる）。 */
  function rememberUndo(chapters: Chapter[], label: string) {
    if (!novel) return;
    const snapshot: UndoSnapshot = { chapters, label, at: Date.now() };
    setUndoSnapshot(snapshot);
    void saveUndoSnapshot(novel.id, snapshot);
  }

  function undo() {
    if (!undoSnapshot || !novel) return;
    const restored = undoSnapshot.chapters;
    update((n) => ({ ...n, chapters: restored }));
    setUndoSnapshot(null);
    void clearUndoSnapshot(novel.id);
    setNotice(`「${undoSnapshot.label}」を元に戻しました。`);
  }

  const scoreColor =
    metrics.score >= 80
      ? 'var(--success)'
      : metrics.score >= 60
        ? 'var(--accent)'
        : 'var(--danger)';

  return (
    <div className="app-shell">
      <div className="app-main">
        <TopBar novelId={novel.id} novelTitle={novel.title} activeTab="polish" />
        <div className="page polish-page">
          <div className="row wrap" style={{ gap: 12, alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>推敲・校正</h2>
            <select
              className="input"
              style={{ width: 'auto' }}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="all">作品全体</option>
              {chapters.map((c, i) => (
                <option key={c.id} value={c.id}>
                  {c.title || `第${i + 1}章`}
                </option>
              ))}
            </select>
            <div className="spacer" style={{ flex: 1 }} />
            <span className="hint" style={{ margin: 0 }}>
              {saveStatus === 'saving' ? '保存中…' : ''}
            </span>
          </div>

          <p className="hint">
            外部AIやサーバーは使わず、端末内のルールだけで原稿をチェックします（通信は発生しません）。
            自動修正は機械的な判定によるものなので、反映後は必ず本文を読み返してください。
          </p>

          {/* ------------------------------ 品質の目安 ------------------------------ */}
          <section className="card polish-metrics">
            <div className="metric-score">
              <motion.div
                className="score-ring"
                style={{ ['--score-color' as string]: scoreColor }}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 220, damping: 22 }}
              >
                <span className="score-value">{metrics.score}</span>
                <span className="score-label">読みやすさの目安</span>
              </motion.div>
              <div className="score-summary">
                <div>
                  <strong>{metrics.chars.toLocaleString()}</strong> 文字 /{' '}
                  <strong>{metrics.sentences.toLocaleString()}</strong> 文 /{' '}
                  <strong>{metrics.paragraphs.toLocaleString()}</strong> 段落
                </div>
                <p className="hint" style={{ margin: '6px 0 0' }}>
                  文体の傾向を数値化した目安です。作風によって適した値は変わるので、
                  低い項目があっても必ずしも直す必要はありません。
                </p>
              </div>
            </div>
            <ul className="metric-list">
              {metrics.rows.map((row) => (
                <li key={row.key} className={`metric-row ${row.status}`}>
                  <span className="metric-label">{row.label}</span>
                  <span className="metric-value">{row.display}</span>
                  <span className="metric-ideal">目安 {row.idealText}</span>
                  <span className="metric-hint">{row.hint}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* ------------------------------ 一括操作 ------------------------------ */}
          <div className="row wrap polish-actions">
            <button
              className="btn btn-primary"
              onClick={applyAllFixes}
              disabled={fixableCount === 0}
            >
              自動修正できる{fixableCount}件をまとめて直す
            </button>
            <button className="btn" onClick={undo} disabled={!undoSnapshot}>
              {undoSnapshot ? `元に戻す（${undoSnapshot.label}）` : '元に戻す'}
            </button>
            <button className="btn" onClick={() => setShowSettings((s) => !s)}>
              {showSettings ? 'チェック項目を閉じる' : 'チェック項目の設定'}
            </button>
            <Link className="btn" to={`/novel/${novel.id}`}>
              執筆画面へ
            </Link>
          </div>

          <AnimatePresence>
            {notice && (
              <motion.p
                className="polish-notice"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {notice}
              </motion.p>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showSettings && (
              <motion.section
                className="card"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ padding: 16 }}>
                  <label className="row" style={{ gap: 8, marginBottom: 14 }}>
                    「一文が長い」と判定する文字数
                    <input
                      className="input"
                      type="number"
                      min={20}
                      max={200}
                      style={{ width: 90 }}
                      value={maxSentenceLength}
                      onChange={(e) =>
                        setMaxSentenceLength(
                          Math.min(200, Math.max(20, Number(e.target.value) || 20))
                        )
                      }
                    />
                  </label>
                  <ul className="rule-list">
                    {PROOF_RULES.map((rule) => (
                      <li key={rule.id}>
                        <label className="rule-item">
                          <input
                            type="checkbox"
                            checked={enabled.has(rule.id)}
                            onChange={() => toggleRule(rule.id)}
                          />
                          <span>
                            <strong>{rule.label}</strong>
                            <span className={`badge badge-${rule.severity}`}>
                              {SEVERITY_LABEL[rule.severity]}
                            </span>
                            {rule.fixable && <span className="badge badge-fix">自動修正</span>}
                            <br />
                            <span className="hint">{rule.description}</span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* ------------------------------ 表記ゆれ ------------------------------ */}
          {variants.length > 0 && (
            <section className="card polish-section">
              <h3>表記ゆれ（{variants.length}件）</h3>
              <p className="hint">
                同じ語に複数の表記が使われています。統一したい表記のボタンを押すと、
                対象範囲の本文をまとめて置き換えます（単純な文字列置換のため、
                置き換え後は本文を確認してください）。
              </p>
              <ul className="variant-list">
                {variants.map((group) => (
                  <li key={group.forms.map((f) => f.form).join('|')}>
                    {group.forms.map((f) => (
                      <button
                        key={f.form}
                        className="btn btn-sm"
                        onClick={() => unify(group, f.form)}
                        title={`「${f.form}」に統一する`}
                      >
                        {f.form}
                        <span className="variant-count">{f.count}</span>
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ------------------------------ 指摘一覧 ------------------------------ */}
          <section className="card polish-section">
            <h3>指摘（{issues.length}件）</h3>
            {issues.length === 0 ? (
              <div className="empty-state" style={{ padding: '30px 0' }}>
                <EmptyIllustration variant="chapter" />
                指摘はありません。
              </div>
            ) : (
              <>
                <div className="row wrap filter-chips">
                  <button
                    className={`chip ${ruleFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setRuleFilter('all')}
                  >
                    すべて {issues.length}
                  </button>
                  {PROOF_RULES.filter((r) => countsByRule.has(r.id)).map((rule) => (
                    <button
                      key={rule.id}
                      className={`chip ${ruleFilter === rule.id ? 'active' : ''} chip-${rule.severity}`}
                      onClick={() => setRuleFilter(rule.id)}
                    >
                      {rule.label} {countsByRule.get(rule.id)}
                    </button>
                  ))}
                </div>
                <ul className="issue-list">
                  {visibleIssues.slice(0, MAX_RENDERED_ISSUES).map((issue, i) => (
                    <li key={`${issue.chapterId}-${issue.ruleId}-${issue.index}-${i}`}>
                      <div className="issue-head">
                        <span className={`badge badge-${issue.severity}`}>
                          {SEVERITY_LABEL[issue.severity]}
                        </span>
                        <strong>{issue.ruleLabel}</strong>
                        <span className="hint">
                          {issue.chapterTitle}・{issue.line}行目
                        </span>
                        <div className="spacer" style={{ flex: 1 }} />
                        {issue.replacement !== undefined && (
                          <button className="btn btn-sm" onClick={() => applyOneFix(issue)}>
                            修正する
                          </button>
                        )}
                        <Link
                          className="btn btn-sm"
                          to={`/novel/${novel.id}?chapter=${issue.chapterId}`}
                        >
                          本文を開く
                        </Link>
                      </div>
                      <p className="issue-excerpt">
                        <span className="ctx">{issue.before}</span>
                        <mark>{issue.target || '␣'}</mark>
                        <span className="ctx">{issue.after}</span>
                      </p>
                      <p className="issue-message">{issue.message}</p>
                    </li>
                  ))}
                </ul>
                {visibleIssues.length > MAX_RENDERED_ISSUES && (
                  <p className="hint">
                    表示件数の上限（{MAX_RENDERED_ISSUES}件）を超えたため、残り
                    {visibleIssues.length - MAX_RENDERED_ISSUES}件は省略しています。
                    修正を反映するか、章やチェック項目を絞り込んでください。
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
