import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useWork } from '../useWork';
import { AppBar, TabBar, NotFound } from '../components/Chrome';
import { PlusIcon, TrashIcon } from '../components/Icons';
import type { Character, PlotPoint, Term } from '../../types';

type Tab = 'people' | 'plot' | 'terms';

const TABS: { key: Tab; label: string }[] = [
  { key: 'people', label: '人物' },
  { key: 'plot', label: '筋書き' },
  { key: 'terms', label: '用語' },
];

const STATUS: { key: PlotPoint['status']; label: string }[] = [
  { key: 'idea', label: '思いつき' },
  { key: 'todo', label: 'これから' },
  { key: 'doing', label: '書いている' },
  { key: 'done', label: '書けた' },
];

export default function Material() {
  const { id } = useParams();
  const { work, update } = useWork(id);
  const [tab, setTab] = useState<Tab>('people');

  const people = useMemo(
    () => (work ? [...work.characters].sort((a, b) => a.order - b.order) : []),
    [work]
  );
  const plot = useMemo(
    () => (work ? [...work.plotPoints].sort((a, b) => a.order - b.order) : []),
    [work]
  );
  const terms = useMemo(
    () => (work?.terms ? [...work.terms].sort((a, b) => a.order - b.order) : []),
    [work]
  );

  if (work === undefined) return <div className="body muted">読み込み中…</div>;
  if (work === null) return <NotFound />;

  function addPerson() {
    const person: Character = {
      id: crypto.randomUUID(),
      name: '',
      kana: '',
      role: '',
      summary: '',
      details: '',
      order: people.length,
    };
    update((w) => ({ ...w, characters: [...w.characters, person] }));
  }

  function patchPerson(pid: string, part: Partial<Character>) {
    update((w) => ({
      ...w,
      characters: w.characters.map((c) => (c.id === pid ? { ...c, ...part } : c)),
    }));
  }

  function removePerson(pid: string) {
    if (!confirm('この人物を削除します。')) return;
    update((w) => ({ ...w, characters: w.characters.filter((c) => c.id !== pid) }));
  }

  function addPlot() {
    const point: PlotPoint = {
      id: crypto.randomUUID(),
      title: '',
      detail: '',
      status: 'idea',
      order: plot.length,
    };
    update((w) => ({ ...w, plotPoints: [...w.plotPoints, point] }));
  }

  function patchPlot(pid: string, part: Partial<PlotPoint>) {
    update((w) => ({
      ...w,
      plotPoints: w.plotPoints.map((p) => (p.id === pid ? { ...p, ...part } : p)),
    }));
  }

  function removePlot(pid: string) {
    if (!confirm('この項目を削除します。')) return;
    update((w) => ({ ...w, plotPoints: w.plotPoints.filter((p) => p.id !== pid) }));
  }

  function addTerm() {
    const term: Term = {
      id: crypto.randomUUID(),
      name: '',
      reading: '',
      description: '',
      order: terms.length,
    };
    update((w) => ({ ...w, terms: [...(w.terms ?? []), term] }));
  }

  function patchTerm(tid: string, part: Partial<Term>) {
    update((w) => ({
      ...w,
      terms: (w.terms ?? []).map((t) => (t.id === tid ? { ...t, ...part } : t)),
    }));
  }

  function removeTerm(tid: string) {
    if (!confirm('この用語を削除します。')) return;
    update((w) => ({ ...w, terms: (w.terms ?? []).filter((t) => t.id !== tid) }));
  }

  return (
    <div className="screen">
      <AppBar title="資料" sub={work.title || '無題'} back="/" />
      <div className="body">
        <div className="chips">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`chip ${tab === t.key ? 'on' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'people' && (
          <>
            <p className="muted">
              名前・立場・口調をそろえておくと、長い作品でも人物がぶれません。
            </p>
            <div className="stack">
              {people.map((p) => (
                <div className="card stack" key={p.id}>
                  <div className="row">
                    <input
                      className="input"
                      style={{ flex: 2, minWidth: 130 }}
                      value={p.name}
                      placeholder="名前"
                      onChange={(e) => patchPerson(p.id, { name: e.target.value })}
                    />
                    <input
                      className="input"
                      style={{ flex: 1, minWidth: 100 }}
                      value={p.kana}
                      placeholder="よみ"
                      onChange={(e) => patchPerson(p.id, { kana: e.target.value })}
                    />
                  </div>
                  <input
                    className="input"
                    value={p.role}
                    placeholder="立場（主人公・敵役・脇役 など）"
                    onChange={(e) => patchPerson(p.id, { role: e.target.value })}
                  />
                  <input
                    className="input"
                    value={p.summary}
                    placeholder="ひとことで言うと"
                    onChange={(e) => patchPerson(p.id, { summary: e.target.value })}
                  />
                  <textarea
                    className="area"
                    rows={3}
                    value={p.details}
                    placeholder="生い立ち・口調・関係・変化していく点など"
                    onChange={(e) => patchPerson(p.id, { details: e.target.value })}
                  />
                  <div className="row">
                    <div className="spacer" />
                    <button
                      className="btn btn-sm btn-quiet btn-danger"
                      onClick={() => removePerson(p.id)}
                    >
                      <TrashIcon />
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {people.length === 0 && (
              <div className="empty">
                <span className="mark">人</span>
                まだ人物がいません。
              </div>
            )}
            <button className="btn btn-wide" style={{ marginTop: 12 }} onClick={addPerson}>
              <PlusIcon />
              人物を足す
            </button>
          </>
        )}

        {tab === 'plot' && (
          <>
            <label className="field">
              <span>あらすじ</span>
              <textarea
                className="area"
                rows={5}
                value={work.synopsis}
                placeholder="どんな話か。販売時の商品説明にもそのまま使えます。"
                onChange={(e) => update((w) => ({ ...w, synopsis: e.target.value }))}
              />
            </label>
            <div className="section-title">場面の並び</div>
            <div className="stack">
              {plot.map((p) => (
                <div className="card stack" key={p.id}>
                  <input
                    className="input"
                    value={p.title}
                    placeholder="場面の見出し"
                    onChange={(e) => patchPlot(p.id, { title: e.target.value })}
                  />
                  <textarea
                    className="area"
                    rows={2}
                    value={p.detail}
                    placeholder="何が起きるか"
                    onChange={(e) => patchPlot(p.id, { detail: e.target.value })}
                  />
                  <div className="row">
                    <select
                      className="input"
                      style={{ width: 'auto' }}
                      value={p.status}
                      onChange={(e) =>
                        patchPlot(p.id, { status: e.target.value as PlotPoint['status'] })
                      }
                    >
                      {STATUS.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <div className="spacer" />
                    <button
                      className="btn btn-sm btn-quiet btn-danger"
                      onClick={() => removePlot(p.id)}
                    >
                      <TrashIcon />
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {plot.length === 0 && (
              <div className="empty">
                <span className="mark">筋</span>
                場面をならべて、話の流れをつくりましょう。
              </div>
            )}
            <button className="btn btn-wide" style={{ marginTop: 12 }} onClick={addPlot}>
              <PlusIcon />
              場面を足す
            </button>
          </>
        )}

        {tab === 'terms' && (
          <>
            <p className="muted">
              地名・組織・造語などの表記と読みをここに集めておくと、表記ゆれを防げます。
            </p>
            <div className="stack">
              {terms.map((t) => (
                <div className="card stack" key={t.id}>
                  <div className="row">
                    <input
                      className="input"
                      style={{ flex: 2, minWidth: 130 }}
                      value={t.name}
                      placeholder="用語"
                      onChange={(e) => patchTerm(t.id, { name: e.target.value })}
                    />
                    <input
                      className="input"
                      style={{ flex: 1, minWidth: 100 }}
                      value={t.reading}
                      placeholder="よみ"
                      onChange={(e) => patchTerm(t.id, { reading: e.target.value })}
                    />
                  </div>
                  <textarea
                    className="area"
                    rows={2}
                    value={t.description}
                    placeholder="どんなものか"
                    onChange={(e) => patchTerm(t.id, { description: e.target.value })}
                  />
                  <div className="row">
                    <div className="spacer" />
                    <button
                      className="btn btn-sm btn-quiet btn-danger"
                      onClick={() => removeTerm(t.id)}
                    >
                      <TrashIcon />
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {terms.length === 0 && (
              <div className="empty">
                <span className="mark">語</span>
                まだ用語がありません。
              </div>
            )}
            <button className="btn btn-wide" style={{ marginTop: 12 }} onClick={addTerm}>
              <PlusIcon />
              用語を足す
            </button>
          </>
        )}
      </div>
      <TabBar workId={work.id} />
    </div>
  );
}
