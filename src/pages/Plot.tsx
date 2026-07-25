import { useParams, Link } from 'react-router-dom';
import TopBar from '../components/TopBar';
import { useNovel } from '../lib/useNovel';
import type { PlotPoint, PlotStatus } from '../types';

const STATUSES: { key: PlotStatus; label: string }[] = [
  { key: 'idea', label: '着想' },
  { key: 'todo', label: '未着手' },
  { key: 'doing', label: '執筆中' },
  { key: 'done', label: '完成' },
];

export default function Plot() {
  const { id } = useParams();
  const { novel, update, saveStatus } = useNovel(id);

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
