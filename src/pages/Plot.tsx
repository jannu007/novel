import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import TopBar from '../components/TopBar';
import EmptyIllustration from '../components/EmptyIllustration';
import { useNovel } from '../lib/useNovel';
import type { Chapter, PlotPoint, PlotStatus } from '../types';
import {
  generateFourActDraft,
  FOUR_ACT_LABELS,
  FOUR_ACT_MIN_TOTAL_CHARS,
  FOUR_ACT_TARGET_CHARS_PER_ACT,
  type FourActDraft,
} from '../lib/draftGenerator';
import { loadPhraseHistory, recordPhraseUsage } from '../lib/phraseHistory';
import { countChars } from '../lib/textStats';

const STATUSES: { key: PlotStatus; label: string }[] = [
  { key: 'idea', label: '着想' },
  { key: 'todo', label: '未着手' },
  { key: 'doing', label: '執筆中' },
  { key: 'done', label: '完成' },
];

const itemVariants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const } },
  exit: { opacity: 0, x: -12, transition: { duration: 0.18 } },
};

export default function Plot() {
  const { id } = useParams();
  const { novel, update, saveStatus } = useNovel(id);
  const navigate = useNavigate();
  const [draft, setDraft] = useState<FourActDraft | null>(null);
  const [variation, setVariation] = useState(0);
  const [applied, setApplied] = useState(false);

  if (novel === undefined) return <div className="page">読み込み中…</div>;
  if (novel === null) {
    return (
      <div className="page">
        <p>作品が見つかりませんでした。</p>
        <Link to="/">ダッシュボードに戻る</Link>
      </div>
    );
  }

  function addPoint() {
    const p: PlotPoint = {
      id: crypto.randomUUID(),
      title: '',
      detail: '',
      status: 'idea',
      order: novel!.plotPoints.length,
    };
    update((n) => ({ ...n, plotPoints: [...n.plotPoints, p] }));
  }

  function patch(pid: string, patch: Partial<PlotPoint>) {
    update((n) => ({
      ...n,
      plotPoints: n.plotPoints.map((p) => (p.id === pid ? { ...p, ...patch } : p)),
    }));
  }

  function remove(pid: string) {
    if (!confirm('このプロットを削除しますか？')) return;
    update((n) => ({
      ...n,
      plotPoints: n.plotPoints.filter((p) => p.id !== pid),
    }));
  }

  function handleGenerate(nextVariation = 0) {
    if (!novel!.synopsis.trim()) {
      alert('先に「作品全体のあらすじ」を入力してください。');
      return;
    }
    setVariation(nextVariation);
    loadPhraseHistory().then((avoid) => {
      const result = generateFourActDraft(novel!, nextVariation, avoid);
      setDraft(result.draft);
      void recordPhraseUsage(result.usedTemplates);
    });
    setApplied(false);
  }

  function applyDraftToChapters() {
    if (!draft) return;
    if (
      !confirm(
        '生成した文章を「起」「承」「転」「結」という章に書き込みます（同名の章があれば上書きします）。よろしいですか？'
      )
    ) {
      return;
    }
    update((n) => {
      let chapters = [...n.chapters];
      if (
        chapters.length === 1 &&
        chapters[0].title === '第一章' &&
        chapters[0].content.trim() === ''
      ) {
        chapters = [];
      }
      const now = Date.now();
      for (const label of FOUR_ACT_LABELS) {
        const text = draft[label.key];
        const idx = chapters.findIndex((c) => c.title === label.title);
        if (idx >= 0) {
          chapters[idx] = { ...chapters[idx], content: text, updatedAt: now };
        } else {
          const newChapter: Chapter = {
            id: crypto.randomUUID(),
            title: label.title,
            content: text,
            order: chapters.length,
            memo: '',
            createdAt: now,
            updatedAt: now,
          };
          chapters.push(newChapter);
        }
      }
      return { ...n, chapters: chapters.map((c, i) => ({ ...c, order: i })) };
    });
    setApplied(true);
  }

  const currentFourAct = FOUR_ACT_LABELS.map((label) => ({
    ...label,
    chapter: novel.chapters.find((c) => c.title === label.title),
  }));
  const currentFourActTotal = currentFourAct.reduce(
    (sum, item) => sum + (item.chapter ? countChars(item.chapter.content) : 0),
    0
  );
  const currentFourActComplete = currentFourAct.every((item) => item.chapter);

  return (
    <div className="app-shell">
      <div className="app-main">
        <TopBar
          novelId={novel.id}
          novelTitle={novel.title}
          activeTab="plot"
          right={
            <span style={{ fontSize: 12, color: 'var(--text-soft)' }}>
              {saveStatus === 'saving' ? '保存中…' : saveStatus === 'saved' ? '✓ 保存済み' : ''}
            </span>
          }
        />
        <div className="page">
          <div className="row between">
            <h1>プロット・あらすじ</h1>
            <motion.button
              className="btn btn-primary"
              onClick={addPoint}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
            >
              ＋ プロットを追加
            </motion.button>
          </div>

          <div className="field">
            <label>作品全体のあらすじ</label>
            <textarea
              className="textarea"
              rows={4}
              placeholder="物語全体の要約。Amazonの商品説明にも流用できます。"
              value={novel.synopsis}
              onChange={(e) =>
                update((n) => ({ ...n, synopsis: e.target.value }))
              }
            />
          </div>

          <div className="section">
            <h2>起承転結の自動下書き生成</h2>
            <div className="card">
              <p style={{ color: 'var(--text-soft)', fontSize: 13 }}>
                あらすじ・キャラクター設定・プロットポイントをもとに、外部AIを使わず端末内だけで
                「起」「承」「転」「結」それぞれ約{FOUR_ACT_TARGET_CHARS_PER_ACT.toLocaleString()}字（4パート合計
                {FOUR_ACT_MIN_TOTAL_CHARS.toLocaleString()}字以上）の下書きを自動で組み立てます。生成後に「章に反映」すると、
                執筆画面に同名の章として書き込まれます（そのままでは簡易的な文章のため、必ず読み返して手直ししてください）。
              </p>
              <div className="row wrap" style={{ marginTop: 8 }}>
                <motion.button
                  className="btn btn-primary"
                  onClick={() => handleGenerate(0)}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                >
                  ✨ あらすじから自動生成
                </motion.button>
                {draft && (
                  <motion.button
                    className="btn"
                    onClick={() => handleGenerate(variation + 1)}
                    whileHover={{ scale: 1.03, rotate: -2 }}
                    whileTap={{ scale: 0.96 }}
                  >
                    🎲 別バージョン
                  </motion.button>
                )}
              </div>

              <AnimatePresence>
                {draft && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div style={{ marginTop: 16 }}>
                      <div className="row" style={{ marginBottom: 8 }}>
                        <span
                          style={{
                            color:
                              FOUR_ACT_LABELS.reduce(
                                (sum, l) => sum + countChars(draft[l.key]),
                                0
                              ) >= FOUR_ACT_MIN_TOTAL_CHARS
                                ? 'var(--success)'
                                : 'var(--danger)',
                            fontWeight: 700,
                          }}
                        >
                          合計{' '}
                          {FOUR_ACT_LABELS.reduce(
                            (sum, l) => sum + countChars(draft[l.key]),
                            0
                          ).toLocaleString()}
                          字
                        </span>
                        <span className="hint">
                          （目安: {FOUR_ACT_MIN_TOTAL_CHARS.toLocaleString()}字以上）
                        </span>
                      </div>
                      <motion.div
                        initial="hidden"
                        animate="show"
                        variants={{ show: { transition: { staggerChildren: 0.08 } } }}
                      >
                        {FOUR_ACT_LABELS.map((label) => (
                          <motion.div key={label.key} className="item-row" variants={itemVariants}>
                            <div className="item-row-head">
                              <strong>{label.title}</strong>
                              <span className="tag">{countChars(draft[label.key])}字</span>
                            </div>
                            <textarea
                              className="textarea"
                              rows={10}
                              value={draft[label.key]}
                              onChange={(e) =>
                                setDraft((d) => (d ? { ...d, [label.key]: e.target.value } : d))
                              }
                            />
                          </motion.div>
                        ))}
                      </motion.div>
                      <div className="row" style={{ marginTop: 8 }}>
                        <motion.button
                          className="btn btn-primary"
                          onClick={applyDraftToChapters}
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.96 }}
                        >
                          この内容を章に反映する
                        </motion.button>
                        <AnimatePresence>
                          {applied && (
                            <motion.span
                              initial={{ opacity: 0, scale: 0.6 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                              style={{ color: 'var(--success)', fontSize: 13 }}
                            >
                              ✓ 反映しました
                            </motion.span>
                          )}
                        </AnimatePresence>
                        {applied && (
                          <button
                            className="btn btn-sm"
                            onClick={() => navigate(`/novel/${novel.id}`)}
                          >
                            執筆画面を開く →
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="section">
            <h2>起承転結の確認</h2>
            <div className="card">
              {!currentFourActComplete ? (
                <div className="empty-state" style={{ padding: '20px 20px' }}>
                  <EmptyIllustration variant="fourAct" />
                  <p style={{ color: 'var(--text-soft)', fontSize: 13, margin: 0 }}>
                    「起」「承」「転」「結」という章がまだ揃っていません。上の「あらすじから自動生成」→「章に反映する」を実行するか、執筆画面で自分でその名前の章を作ると、ここで内容を確認できるようになります。
                  </p>
                </div>
              ) : (
                <>
                  <div className="row" style={{ marginBottom: 12 }}>
                    <span
                      style={{
                        color:
                          currentFourActTotal >= FOUR_ACT_MIN_TOTAL_CHARS
                            ? 'var(--success)'
                            : 'var(--danger)',
                        fontWeight: 700,
                      }}
                    >
                      {currentFourActTotal >= FOUR_ACT_MIN_TOTAL_CHARS ? '✓' : '！'} 合計{' '}
                      {currentFourActTotal.toLocaleString()}字
                    </span>
                    <span className="hint">
                      （目安: {FOUR_ACT_MIN_TOTAL_CHARS.toLocaleString()}字以上）
                    </span>
                  </div>
                  <motion.div
                    initial="hidden"
                    animate="show"
                    variants={{ show: { transition: { staggerChildren: 0.06 } } }}
                  >
                    {currentFourAct.map((item) => (
                      <motion.div key={item.key} className="item-row" variants={itemVariants}>
                        <div className="item-row-head">
                          <strong>{item.title}</strong>
                          <span className="tag">
                            {item.chapter ? countChars(item.chapter.content).toLocaleString() : 0}字
                          </span>
                          {item.chapter && (
                            <button
                              className="btn btn-sm"
                              onClick={() =>
                                navigate(`/novel/${novel.id}?chapter=${item.chapter!.id}`)
                              }
                            >
                              執筆画面で開く →
                            </button>
                          )}
                        </div>
                        <p
                          style={{
                            fontSize: 13,
                            color: 'var(--text-soft)',
                            maxHeight: 100,
                            overflow: 'auto',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {item.chapter?.content || '（本文がありません）'}
                        </p>
                      </motion.div>
                    ))}
                  </motion.div>
                </>
              )}
            </div>
          </div>

          <h2 style={{ marginTop: 24 }}>プロットポイント</h2>
          {novel.plotPoints.length === 0 && (
            <div className="empty-state">
              <EmptyIllustration variant="plot" />
              起承転結やシーンの流れを箇条書きで整理しましょう。
            </div>
          )}
          <AnimatePresence>
            {novel.plotPoints.map((p) => (
              <motion.div
                className="item-row"
                key={p.id}
                layout
                variants={itemVariants}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                <div className="item-row-head">
                  <input
                    className="name"
                    placeholder="シーン・出来事のタイトル"
                    value={p.title}
                    onChange={(e) => patch(p.id, { title: e.target.value })}
                  />
                  <select
                    className="status-select"
                    value={p.status}
                    onChange={(e) =>
                      patch(p.id, { status: e.target.value as PlotStatus })
                    }
                  >
                    {STATUSES.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => remove(p.id)}
                  >
                    削除
                  </button>
                </div>
                <textarea
                  className="textarea"
                  rows={2}
                  placeholder="このシーンで起こること、伏線、目的など"
                  value={p.detail}
                  onChange={(e) => patch(p.id, { detail: e.target.value })}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
