export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 本文プレーンテキストを段落HTMLに変換する。
 * 空行が挟まれると、シーン区切り（＊）を自動的に挿入する。
 */
export function contentToParagraphs(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const html: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      blankRun++;
      continue;
    }
    if (blankRun > 0 && html.length > 0) {
      html.push('<p class="scene-break">＊</p>');
    }
    blankRun = 0;
    html.push(`<p>${escapeHtml(line)}</p>`);
  }
  return html;
}
