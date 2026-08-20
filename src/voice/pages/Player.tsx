/**
 * 朗読の画面。
 *
 * 本文を文ごとに並べ、いま読んでいる一文を光らせる。目で追ってもよいし、
 * 画面を消して耳だけで聴いてもよい。文をたたけば、そこから読み直す。
 *
 * 読み上げそのものは `speech.ts` の `Narrator` が受け持つ。
 * この画面は「どこを読んでいるか」を見せて、操作を渡すだけにしてある。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { buildBook } from '../../read/book';
import { loadBook, saveBook, type VoiceBook } from '../db';
import {
  chapterStarts,
  durationLabel,
  estimateSeconds,
  segmentBook,
  type Line,
} from '../segment';
import { Narrator, type PlayerState } from '../speech';
import { useSettings } from '../settings';
import { useVoices } from '../useVoices';

/** 眠るまでの時間の選択肢（分）。0は使わない。 */
const SLEEP_CHOICES = [0, 10, 20, 30, 60];

export default function Player() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { settings, update } = useSettings();

  const [book, setBook] = useState<VoiceBook | null>(null);
  const [missing, setMissing] = useState(false);
  const [index, setIndex] = useState(0);
  const [state, setState] = useState<PlayerState>('idle');
  const [trouble, setTrouble] = useState('');
  const [showChapters, setShowChapters] = useState(false);
  const [sleepMinutes, setSleepMinutes] = useState(0);

  const pickVoice = useCallback((name: string) => update({ voiceName: name }), [update]);
  const { survey, ready, canSpeak } = useVoices(settings.voiceName, pickVoice);

  /* ---- 本を読み込んで、文の並びに切り分ける ---- */

  useEffect(() => {
    let alive = true;
    loadBook(id).then((found) => {
      if (!alive) return;
      if (!found) {
        setMissing(true);
        return;
      }
      setBook(found);
      setIndex(found.position?.line ?? 0);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const content = useMemo(
    () => (book ? buildBook(book.source, book.title) : null),
    [book]
  );

  const lines: Line[] = useMemo(
    () => (content ? segmentBook(content, settings.segment) : []),
    [content, settings.segment]
  );

  const starts = useMemo(
    () => (content ? chapterStarts(lines, content.chapters.length) : []),
    [lines, content]
  );

  /* ---- 読み上げの本体 ---- */

  const narrator = useRef<Narrator | null>(null);
  /** 画面の再描画で作り直されないよう、番号は箱に入れて持っておく */
  const indexRef = useRef(0);
  indexRef.current = index;

  if (narrator.current === null) {
    narrator.current = new Narrator(
      {
        onIndex: setIndex,
        onState: setState,
        onFinish: () => setTrouble(''),
        onTrouble: setTrouble,
      },
      {
        rate: settings.rate,
        pitch: settings.pitch,
        volume: settings.volume,
        voiceName: settings.voiceName,
      }
    );
  }

  // 文の並びが変わったら入れ直し、覚えていた場所に戻す
  useEffect(() => {
    const engine = narrator.current;
    if (!engine || lines.length === 0) return;
    engine.setLines(lines.map((l) => l.spoken));
    engine.seek(Math.min(indexRef.current, lines.length - 1));
    // 並びそのものが変わったときだけやり直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  // 速さや声を変えたら、すぐ反映する
  useEffect(() => {
    narrator.current?.setOptions({
      rate: settings.rate,
      pitch: settings.pitch,
      volume: settings.volume,
      voiceName: settings.voiceName,
    });
  }, [settings.rate, settings.pitch, settings.volume, settings.voiceName]);

  // 画面を離れるときは必ず止める（別の画面で声だけ鳴り続けるのを防ぐ）
  useEffect(() => {
    const engine = narrator.current;
    return () => engine?.stop();
  }, []);

  /* ---- どこまで聴いたかを覚える ---- */

  useEffect(() => {
    if (!book || lines.length === 0) return;
    const ratio = lines.length <= 1 ? 0 : index / (lines.length - 1);
    const timer = setTimeout(() => {
      saveBook({
        ...book,
        openedAt: Date.now(),
        position: { line: index, ratio, at: Date.now() },
      }).catch(() => {
        /* 保存できなくても聴き続けられる */
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [book, index, lines.length]);

  /* ---- 読み上げ中は画面を消さない ---- */

  useEffect(() => {
    if (!settings.awake || state !== 'playing') return;
    let sentinel: WakeLockSentinel | null = null;
    let released = false;
    navigator.wakeLock
      ?.request('screen')
      .then((lock) => {
        if (released) lock.release().catch(() => {});
        else sentinel = lock;
      })
      .catch(() => {
        /* 使えない端末では、そのまま（画面は消えるが音は続く） */
      });
    return () => {
      released = true;
      sentinel?.release().catch(() => {});
    };
  }, [settings.awake, state]);

  /* ---- 眠るまでの時間 ---- */

  useEffect(() => {
    if (sleepMinutes <= 0 || state !== 'playing') return;
    const timer = setTimeout(() => {
      narrator.current?.pause();
      setSleepMinutes(0);
    }, sleepMinutes * 60 * 1000);
    return () => clearTimeout(timer);
  }, [sleepMinutes, state]);

  /* ---- 読んでいる文を画面の中へ送る ---- */

  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!settings.follow) return;
    const node = stageRef.current?.querySelector<HTMLElement>('[data-now="1"]');
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [index, settings.follow]);

  /* ---- 操作 ---- */

  const toggle = () => {
    const engine = narrator.current;
    if (!engine) return;
    setTrouble('');
    if (state === 'playing') engine.pause();
    else if (state === 'paused') engine.resume();
    else engine.play(index);
  };

  const step = (delta: number) => narrator.current?.seek(index + delta);

  const chapterOf = lines[index]?.chapter ?? 0;

  const jumpChapter = (delta: number) => {
    const next = Math.min(Math.max(chapterOf + delta, 0), starts.length - 1);
    narrator.current?.seek(starts[next] ?? 0);
    setShowChapters(false);
  };

  if (missing) {
    return (
      <div className="app">
        <header className="bar">
          <button className="icon-btn" onClick={() => navigate('/')}>
            戻る
          </button>
          <h1>見つかりません</h1>
        </header>
        <p className="note" style={{ marginTop: 20 }}>
          この本は書棚にありません。削除されたか、別の端末の書棚かもしれません。
        </p>
      </div>
    );
  }

  if (!book || !content) return null;

  const left = estimateSeconds(lines, index, settings.rate);
  const total = estimateSeconds(lines, 0, settings.rate);

  return (
    <div className="app">
      <header className="bar">
        <button className="icon-btn" onClick={() => navigate('/')}>
          書棚
        </button>
        <h1>{book.title}</h1>
        <button className="icon-btn" onClick={() => setShowChapters((v) => !v)}>
          目次
        </button>
        <button className="icon-btn" onClick={() => navigate('/settings')}>
          設定
        </button>
      </header>

      {/*
        声が見つからないときは、はっきり伝えて読み上げない。
        既定の声に任せると、本文がメーカーのサーバーへ送られる恐れがある。
      */}
      {ready && !canSpeak && (
        <div className="banner warn">
          <b>読み上げできません。</b>
          {survey.unsupported
            ? 'この端末のブラウザには読み上げのしくみがありません。'
            : '端末の中だけで話す声が見つかりませんでした。'}
          {survey.refused > 0 && (
            <>
              {' '}
              見つかった声のうち{survey.refused}個は、本文をメーカーのサーバーへ送って
              読み上げる種類のものでした。本の中身を外に出さないため、語り部はこれらを
              使いません。端末の設定から読み上げ（音声合成）のデータを入れると使えます。
            </>
          )}
        </div>
      )}

      {trouble && <div className="banner warn">{trouble}</div>}

      {showChapters && (
        <div className="card section">
          <h2>目次</h2>
          <div className="chapters">
            {content.chapters.map((chapter, i) => (
              <button
                key={chapter.id}
                className={`chapter-item${i === chapterOf ? ' now' : ''}`}
                onClick={() => {
                  narrator.current?.seek(starts[i] ?? 0);
                  setShowChapters(false);
                }}
              >
                {chapter.title || `第${i + 1}章`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="stage" ref={stageRef} style={{ fontSize: settings.size }}>
        {lines.map((line, i) => (
          <button
            key={i}
            data-now={i === index ? '1' : undefined}
            className={`line${i === index ? ' now' : i < index ? ' done' : ''}${
              line.heading ? ' heading' : ''
            }`}
            onClick={() => narrator.current?.seek(i)}
          >
            {line.text}
          </button>
        ))}
      </div>

      <div className="deck">
        <div className="deck-inner">
          <input
            className="deck-scrub"
            type="range"
            min={0}
            max={Math.max(0, lines.length - 1)}
            value={index}
            aria-label="聴いている場所"
            onChange={(e) => narrator.current?.seek(Number(e.target.value))}
          />
          <div className="deck-time">
            <span>
              {content.chapters[chapterOf]?.title || `第${chapterOf + 1}章`}
            </span>
            <span>
              残り{durationLabel(left)} / 全{durationLabel(total)}
            </span>
          </div>

          <div className="deck-row">
            <button
              className="round"
              onClick={() => jumpChapter(-1)}
              disabled={chapterOf === 0}
              aria-label="前の章へ"
            >
              章◀
            </button>
            <button className="round" onClick={() => step(-1)} aria-label="一文もどる">
              ◀
            </button>
            <button
              className="round big"
              onClick={toggle}
              disabled={!canSpeak}
              aria-label={state === 'playing' ? '止める' : '読み上げる'}
            >
              {state === 'playing' ? '一時停止' : '再生'}
            </button>
            <button className="round" onClick={() => step(1)} aria-label="一文すすむ">
              ▶
            </button>
            <button
              className="round"
              onClick={() => jumpChapter(1)}
              disabled={chapterOf >= starts.length - 1}
              aria-label="次の章へ"
            >
              章▶
            </button>
          </div>

          <div className="deck-row" style={{ marginTop: 10, gap: 14 }}>
            <label className="note" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              速さ
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={settings.rate}
                onChange={(e) => update({ rate: Number(e.target.value) })}
              />
              <span style={{ whiteSpace: 'nowrap' }}>{settings.rate.toFixed(2)}倍</span>
            </label>
            <label className="note" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              おやすみ
              <select
                value={sleepMinutes}
                onChange={(e) => setSleepMinutes(Number(e.target.value))}
              >
                {SLEEP_CHOICES.map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? 'なし' : `${m}分`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
