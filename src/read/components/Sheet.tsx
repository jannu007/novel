/**
 * 下から出てくるシート。目次・設定・検索・しおりの入れ物として使う。
 * 画面のどこを押しても閉じられ、Escキーでも閉じる。
 *
 * 文字を入力するシートでは、画面の下半分をキーボードが覆う。
 * そのままだと下のボタンが画面の外に出てしまうので、
 * 見えている高さ（visualViewport）に合わせてシートを縮め、
 * 決定ボタンは `footer` に置いて、いつでも押せる位置に固定している。
 */

import { useEffect, type ReactNode } from 'react';
import { CloseIcon } from './Icons';

export default function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** スクロールさせずに下端へ固定して見せるもの（決定ボタンなど） */
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  // キーボードが出ている間の「実際に見えている高さ」をCSSに渡す
  useEffect(() => {
    const vv = window.visualViewport;
    if (!open || !vv) return;
    const apply = () => {
      document.documentElement.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      document.documentElement.style.removeProperty('--vvh');
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <strong>{title}</strong>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">
            <CloseIcon />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
