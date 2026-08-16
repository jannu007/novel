/**
 * 通信の口を、アプリ自身の手でも塞いでおく（二重の備え）。
 *
 * 本来はHTMLに書いたCSPの `connect-src 'none'` が止めてくれる。
 * ただしCSPは「配信されたHTMLの宣言をブラウザが守る」ことが前提で、
 *   ・一部のアプリ内ブラウザは `<meta>` のCSPを読み飛ばすことがある
 *   ・拡張機能が差し込んだコードにはCSPが効かない場合がある
 *   ・WebRTC（RTCPeerConnection）は connect-src の対象外になる環境がある
 * といった隙が残る。そこで、栞が一度も使わない「外へ送る道具」を
 * 起動直後に取り上げてしまう。CSPが効かない場所でも、道具が無ければ送れない。
 *
 * 栞はこれらを1か所も使っていないので、取り上げても機能は何も減らない。
 * （サービスワーカーの中は別の世界なので影響を受けない。オフライン起動は従来どおり動く。）
 */

/** 取り上げる道具。どれも「文字を外へ送る」ために使えるもの。 */
const BLOCKED = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'RTCPeerConnection',
  'webkitRTCPeerConnection',
  'RTCDataChannel',
] as const;

function refuse(name: string): never {
  throw new Error(`栞は通信しません（${name} は使えないようにしてあります）`);
}

/** 書き換えも復元もできない形で置き換える。 */
function seal(target: object, key: string, value: unknown): void {
  try {
    Object.defineProperty(target, key, {
      value,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  } catch {
    /* 置き換えられない環境では、CSP側の禁止に任せる */
  }
}

export function lockdown(): void {
  const w = window as unknown as Record<string, unknown>;

  for (const name of BLOCKED) {
    if (!(name in w)) continue;
    seal(w, name, function blocked(): never {
      refuse(name);
    });
  }

  // sendBeacon は「画面を閉じる瞬間にこっそり送る」ための道具。必ず塞ぐ。
  if ('sendBeacon' in navigator) {
    seal(navigator, 'sendBeacon', () => false);
  }
}
