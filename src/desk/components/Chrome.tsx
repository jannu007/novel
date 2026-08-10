import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BackIcon, PenIcon, BookIcon, CheckIcon, ShipIcon, CloseIcon } from './Icons';

export function AppBar({
  title,
  sub,
  back,
  actions,
}: {
  title: string;
  sub?: string;
  /** 戻り先。省略すると戻るボタンを出さない */
  back?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="appbar">
      {back && (
        <Link to={back} className="icon-btn" aria-label="戻る">
          <BackIcon />
        </Link>
      )}
      <h1>
        {title}
        {sub && <span className="sub">{sub}</span>}
      </h1>
      {actions}
    </header>
  );
}

const TABS = [
  { to: '', label: '執筆', Icon: PenIcon },
  { to: '/material', label: '資料', Icon: BookIcon },
  { to: '/polish', label: '推敲', Icon: CheckIcon },
  { to: '/export', label: '仕上げ', Icon: ShipIcon },
];

/** 画面下のタブ。親指の届く位置に主要な導線をまとめている。 */
export function TabBar({ workId }: { workId: string }) {
  const { pathname } = useLocation();
  const root = `/w/${workId}`;
  return (
    <nav className="tabbar">
      {TABS.map(({ to, label, Icon }) => {
        const path = root + to;
        const on = to === '' ? pathname === root : pathname === path;
        return (
          <Link key={label} to={path} className={on ? 'on' : ''}>
            <Icon />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * 下から出るシート。スマートフォンで片手のまま扱えるよう、
 * 一覧や設定はダイアログではなくシートで表示する。
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={title}>
        <div className="grip" />
        <div className="sheet-head">
          <b>{title}</b>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">
            <CloseIcon />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}

/** 作品が見つからないときの共通表示。 */
export function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="screen no-tabs">
      <AppBar title="見つかりません" back="/" />
      <div className="body">
        <div className="empty">
          <span className="mark">空</span>
          この作品は見つかりませんでした。
        </div>
        <button className="btn btn-wide" onClick={() => navigate('/')}>
          作品一覧へ
        </button>
      </div>
    </div>
  );
}
