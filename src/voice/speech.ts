/**
 * 声を出すしくみ（音声合成）。語り部でいちばん大事な部分。
 *
 * ■ ここが朗読アプリの、唯一にして最大の漏れ口
 *
 * 読むだけのアプリなら、通信を全部塞げば本文は端末から出ない。
 * ところが「読み上げる」となると事情が変わる。ブラウザの音声合成
 * （SpeechSynthesis）に登録されている声には、大きく2種類あるからだ。
 *
 *   1. 端末の中で音を作る声（localService === true）
 *      … OSに入っている読み上げエンジン。文字は端末の外に出ない。
 *   2. メーカーのサーバーで音を作る声（localService === false）
 *      … 文字をネット越しに送り、返ってきた音を鳴らす。
 *        パソコン版Chromeの「Google 日本語」などがこれにあたる。
 *
 * 2 の声に本文を渡すと、**本文はそのままメーカーのサーバーへ送られる**。
 * しかもこの送信はブラウザ自身が行うため、ページに掛けたCSPでは止まらない。
 * `connect-src 'none'` も、`fetch` を取り上げる細工（lockdown.ts）も、
 * どちらも一切効かない。朗読アプリの本文が漏れるとしたら、まずここである。
 *
 * ■ 語り部の決まり
 *
 *   ・話す前に必ず声を1つ選び、`utterance.voice` に入れる。
 *   ・選べるのは `localService === true` の声だけ。一覧にも出さない。
 *   ・端末の中で話す声が1つも無いときは、**読み上げない**。
 *     代わりに、なぜ読み上げないのかを画面で伝える。
 *
 * 3つ目が肝心なところで、`utterance.voice` を空のままにすると
 * ブラウザが既定の声を勝手に選ぶ。その既定が 2 の声だと、黙って
 * 本文が送られてしまう。「声が無ければ黙る」ほうを選ぶ。
 *
 * ■ もうひとつの決まり：一度に渡すのは一文だけ
 *
 * 本文をまるごと渡さず、文ごとに切って渡す。仮に将来この判定が
 * すり抜けても、渡っているのは常に一文で、本一冊ではない。
 * （読み上げ位置の追従と、長文で止まるブラウザの癖への対策も兼ねる。）
 */

export interface VoiceInfo {
  /** `speechSynthesis` が返す声を引き当てるための名前 */
  name: string;
  lang: string;
  /** 端末の中だけで音を作る声か。語り部が使うのはこれが true のものだけ。 */
  local: boolean;
  /** 画面に出す名前 */
  label: string;
}

/** 声の調べがついたときの結果。 */
export interface VoiceSurvey {
  /** 使ってよい声（端末の中で話すもの）。 */
  usable: VoiceInfo[];
  /** 使わずに伏せた声の数（画面で「◯個は使いません」と伝えるため）。 */
  refused: number;
  /** 音声合成そのものがこの端末に無い */
  unsupported: boolean;
}

const synth: SpeechSynthesis | undefined =
  typeof window !== 'undefined' ? window.speechSynthesis : undefined;

export function speechSupported(): boolean {
  return Boolean(synth && typeof SpeechSynthesisUtterance === 'function');
}

/**
 * 声の一覧は、ブラウザによっては最初の呼び出しで空が返る（あとから届く）。
 * `voiceschanged` を待ちつつ、届かない端末のために時間切れも用意する。
 */
function rawVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!synth) return resolve([]);
    const now = synth.getVoices();
    if (now.length > 0) return resolve(now);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      synth.removeEventListener('voiceschanged', finish);
      resolve(synth.getVoices());
    };
    synth.addEventListener('voiceschanged', finish);
    // 届かない端末（`voiceschanged` を出さない実装がある）のための保険
    setTimeout(finish, 2000);
  });
}

/** 日本語の声を先に、次に読み上げやすい順に並べる。 */
function order(a: VoiceInfo, b: VoiceInfo): number {
  const ja = (v: VoiceInfo) => (v.lang.toLowerCase().startsWith('ja') ? 0 : 1);
  if (ja(a) !== ja(b)) return ja(a) - ja(b);
  return a.label.localeCompare(b.label, 'ja');
}

/**
 * この端末で使える声を調べる。
 *
 * ここが「端末の中で話す声だけを通す関門」。ほかの場所では声を選ばない。
 */
export async function surveyVoices(): Promise<VoiceSurvey> {
  if (!speechSupported()) return { usable: [], refused: 0, unsupported: true };

  const all = await rawVoices();
  const usable: VoiceInfo[] = [];
  let refused = 0;

  for (const v of all) {
    /*
     * `localService` が false の声は、文字をメーカーのサーバーへ送る。
     * 判定できない（undefined）ものも、安全な側に倒して使わない。
     */
    if (v.localService !== true) {
      refused++;
      continue;
    }
    usable.push({
      name: v.name,
      lang: v.lang,
      local: true,
      label: `${v.name}（${v.lang}）`,
    });
  }

  usable.sort(order);
  return { usable, refused, unsupported: false };
}

/**
 * 名前から、実際に話させる声を引き当てる。
 *
 * 引き当てた声にも**もう一度** `localService` を確かめる。
 * 一覧を作ったあとに端末の声が入れ替わることがあるためで、
 * ここが最後の関門になる。確かめられなければ `null` を返し、
 * 呼び出し側は読み上げをやめる。
 */
function resolveVoice(name: string): SpeechSynthesisVoice | null {
  if (!synth) return null;
  const found = synth.getVoices().find((v) => v.name === name);
  if (!found) return null;
  if (found.localService !== true) return null;
  return found;
}

export interface SpeakOptions {
  /** 話す速さ（0.5〜2.0 くらい） */
  rate: number;
  /** 声の高さ（0〜2） */
  pitch: number;
  /** 音の大きさ（0〜1） */
  volume: number;
  /** 使う声の名前 */
  voiceName: string;
}

export type PlayerState = 'idle' | 'playing' | 'paused';

export interface EngineHandlers {
  /** いま何番目の文を読んでいるか */
  onIndex(index: number): void;
  onState(state: PlayerState): void;
  /** 最後まで読み終えた */
  onFinish(): void;
  /** 読み上げられない事情が起きた（画面に出す言葉） */
  onTrouble(message: string): void;
}

/**
 * 朗読を進める本体。
 *
 * 文の配列を受け取り、1文ずつ声に渡す。次の文へ進むのは
 * 「読み終わった合図（onend）」を受け取ったときだけにしてある。
 */
export class Narrator {
  private lines: string[] = [];
  private index = 0;
  private state: PlayerState = 'idle';
  private options: SpeakOptions;
  private handlers: EngineHandlers;
  /** いま鳴らしている読み上げ。取り違えて二重に進めないための目印。 */
  private current: SpeechSynthesisUtterance | null = null;
  /** 長い文の途中で勝手に止まるブラウザへの対策 */
  private keepAlive: ReturnType<typeof setInterval> | null = null;

  constructor(handlers: EngineHandlers, options: SpeakOptions) {
    this.handlers = handlers;
    this.options = options;
  }

  setLines(lines: string[]): void {
    this.stop();
    this.lines = lines;
    this.index = 0;
  }

  setOptions(options: SpeakOptions): void {
    this.options = options;
    /*
     * 速さや声を変えたら、いま読んでいる文を読み直す。
     * 途中から差し替えることはできない決まりなので、文の頭に戻す。
     */
    if (this.state === 'playing') this.play(this.index);
  }

  getIndex(): number {
    return this.index;
  }

  getState(): PlayerState {
    return this.state;
  }

  /** 指定の文から読み始める。 */
  play(from?: number): void {
    if (!synth) {
      this.handlers.onTrouble('この端末では読み上げを使えません');
      return;
    }
    if (typeof from === 'number') this.index = clamp(from, 0, this.lines.length - 1);
    if (this.lines.length === 0) return;

    const voice = resolveVoice(this.options.voiceName);
    if (!voice) {
      /*
       * 声を引き当てられなかった＝端末の中で話す声が無い。
       * ここで既定の声に任せると、本文が外へ送られる恐れがある。読まない。
       */
      this.setState('idle');
      this.handlers.onTrouble(
        '端末の中だけで話す声が見つからないため、読み上げを止めました（本文を外へ送らないためです）'
      );
      return;
    }

    this.cancel();
    this.speakAt(this.index, voice);
  }

  private speakAt(index: number, voice: SpeechSynthesisVoice): void {
    if (!synth) return;
    if (index >= this.lines.length) {
      this.setState('idle');
      this.handlers.onFinish();
      return;
    }

    this.index = index;
    this.handlers.onIndex(index);

    const utterance = new SpeechSynthesisUtterance(this.lines[index]);

    /*
     * 声を指定できなかったときは、読み上げをやめる。
     *
     * ここで先へ進むと、声が空のまま `speak()` に渡ることになり、
     * ブラウザが既定の声を勝手に選ぶ。その既定が「外へ送る声」だと、
     * 本文が黙ってメーカーのサーバーへ渡ってしまう。
     * 読めないほうがましなので、止める。
     */
    try {
      utterance.voice = voice;
      // 声にひもづく言語を明示する（言語が空だと別の声で読まれる端末がある）
      utterance.lang = voice.lang;
    } catch {
      this.current = null;
      this.setState('idle');
      this.handlers.onTrouble(
        '声を指定できなかったため、読み上げを止めました（本文を外へ送らないためです）'
      );
      return;
    }
    if (utterance.voice !== voice) {
      // 代入は通ったのに入っていない＝この端末では指定が効いていない
      this.current = null;
      this.setState('idle');
      this.handlers.onTrouble(
        '声を指定できなかったため、読み上げを止めました（本文を外へ送らないためです）'
      );
      return;
    }

    utterance.rate = this.options.rate;
    utterance.pitch = this.options.pitch;
    utterance.volume = this.options.volume;

    utterance.onend = () => {
      // 取り消したあとに届いた合図では進めない
      if (this.current !== utterance) return;
      this.current = null;
      if (this.state !== 'playing') return;
      this.speakAt(index + 1, voice);
    };

    utterance.onerror = (event) => {
      if (this.current !== utterance) return;
      this.current = null;
      // 自分で止めたときにも error が来る実装がある。それは知らせない。
      if (event.error === 'interrupted' || event.error === 'canceled') return;
      this.setState('idle');
      this.handlers.onTrouble('読み上げが途切れました（もう一度お試しください）');
    };

    this.current = utterance;
    this.setState('playing');
    synth.speak(utterance);
    this.startKeepAlive();
  }

  pause(): void {
    if (!synth || this.state !== 'playing') return;
    try {
      synth.pause();
    } catch {
      /* 止められない端末では、取り消して同じ文から読み直せるようにする */
      this.cancel();
    }
    this.stopKeepAlive();
    this.setState('paused');
  }

  resume(): void {
    if (!synth || this.state !== 'paused') return;
    /*
     * `pause()` が効かず取り消しになった端末では、鳴らすものが残っていない。
     * その場合は同じ文の頭から読み直す。
     */
    if (!this.current || !synth.paused) {
      this.play(this.index);
      return;
    }
    try {
      synth.resume();
      this.setState('playing');
      this.startKeepAlive();
    } catch {
      this.play(this.index);
    }
  }

  stop(): void {
    this.cancel();
    this.setState('idle');
  }

  /** 前後の文へ飛ぶ。読み上げ中なら、その場から読み直す。 */
  seek(index: number): void {
    const next = clamp(index, 0, Math.max(0, this.lines.length - 1));
    const wasPlaying = this.state === 'playing';
    this.cancel();
    this.index = next;
    this.handlers.onIndex(next);
    if (wasPlaying) this.play(next);
    else this.setState(this.state === 'paused' ? 'idle' : this.state);
  }

  private cancel(): void {
    this.current = null;
    this.stopKeepAlive();
    try {
      synth?.cancel();
    } catch {
      /* 取り消せない端末では、次の speak が上書きする */
    }
  }

  private setState(state: PlayerState): void {
    if (this.state === state) return;
    this.state = state;
    this.handlers.onState(state);
  }

  /**
   * 一部のブラウザは、読み上げが15秒ほど続くと黙って止まってしまう。
   * 語り部は文ごとに切って渡すので普通は届かないが、句点の無い長い文では
   * 起こりうる。定期的に「続けて」と声を掛けて取りこぼしを防ぐ。
   */
  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAlive = setInterval(() => {
      if (!synth || this.state !== 'playing') return;
      if (synth.speaking && !synth.paused) {
        try {
          synth.pause();
          synth.resume();
        } catch {
          /* 効かない端末では何もしない */
        }
      }
    }, 10000);
  }

  private stopKeepAlive(): void {
    if (this.keepAlive === null) return;
    clearInterval(this.keepAlive);
    this.keepAlive = null;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
