import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar';
import { useNovel } from '../lib/useNovel';
import type { Chapter, PlotPoint, PlotStatus } from '../types';
import {
  generateFourActDraft,
  FOUR_ACT_LABELS,
  type FourActDraft,
} from '../lib/draftGenerator';
import { countChars } from '../lib/textStats';

const STATUSES: { key: PlotStatus; label: string }[] = [
  { key: 'idea', label: '着想' },
  { key: 'todo', label: '未着手' },
  { key: 'doing', label: '執筆中' },
  { key: 'done', label: '完成' },
];

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
    setDraft(generateFourActDraft(novel!, nextVariation));
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
        chapters[0].content.trim() === '' &&
        !FOUR_ACT_LABELS.some((l) => l.title === chapters[0].title)
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
            <button className="btn btn-primary" onClick={addPoint}>
              ＋ プロットを追加
            </button>
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
                「起」「承」「転」「結」それぞれ約200字の下書きを自動で組み立てます。生成後に「章に反映」すると、
                執筆画面に同名の章として書き込まれます（そのままでは簡易的な文章のため、必ず読み返して手直ししてください）。
              </p>
              <div className="row wrap" style={{ marginTop: 8 }}>
                <button className="btn btn-primary" onClick={() => handleGenerate(0)}>
                  ✨ あらすじから自動生成
                </button>
                {draft && (
                  <button className="btn" onClick={() => handleGenerate(variation + 1)}>
                    🎲 別バージョン
                  </button>
                )}
              </div>

              {draft && (
                <div style={{ marginTop: 16 }}>
                  {FOUR_ACT_LABELS.map((label) => (
                    <div key={label.key} className="item-row">
                      <div className="item-row-head">
                        <strong>{label.title}</strong>
                        <span className="tag">{countChars(draft[label.key])}字</span>
                      </div>
                      <textarea
                        className="textarea"
                        rows={4}
                        value={draft[label.key]}
                        onChange={(e) =>
                          setDraft((d) => (d ? { ...d, [label.key]: e.target.value } : d))
                        }
                      />
                    </div>
                  ))}
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn btn-primary" onClick={applyDraftToChapters}>
                      この内容を章に反映する
                    </button>
                    {applied && (
                      <>
                        <span style={{ color: 'var(--success)', fontSize: 13 }}>
                          ✓ 反映しました
                        </span>
                        <button
                          className="btn btn-sm"
                          onClick={() => navigate(`/novel/${novel.id}`)}
                        >
                          執筆画面を開く →
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <h2 style={{ marginTop: 24 }}>プロットポイント</h2>
          {novel.plotPoints.length === 0 && (
            <div className="empty-state">
              起承転結やシーンの流れを箇条書きで整理しましょう。
            </div>
          )}
          {novel.plotPoints.map((p) => (
            <div className="item-row" key={p.id}>
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
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
