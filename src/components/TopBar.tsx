import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

interface Props {
  novelId?: string;
  novelTitle?: string;
  right?: ReactNode;
  activeTab?: 'write' | 'characters' | 'plot' | 'export';
}

export default function TopBar({ novelId, novelTitle, right, activeTab }: Props) {
  return (
    <div className="topbar">
      <Link to="/" className="brand">
        <span className="logo-dot" />
        小説執筆スタジオ
      </Link>
      {novelId && (
        <nav className="nav-tabs">
          <Link
            to={`/novel/${novelId}`}
            className={activeTab === 'write' ? 'active' : ''}
          >
            執筆
          </Link>
          <Link
            to={`/novel/${novelId}/characters`}
            className={activeTab === 'characters' ? 'active' : ''}
          >
            キャラクター
          </Link>
          <Link
            to={`/novel/${novelId}/plot`}
            className={activeTab === 'plot' ? 'active' : ''}
          >
            プロット
          </Link>
          <Link
            to={`/novel/${novelId}/export`}
            className={activeTab === 'export' ? 'active' : ''}
          >
            出版準備
          </Link>
        </nav>
      )}
      {novelTitle && (
        <span style={{ color: 'var(--text-soft)', fontSize: 13 }}>
          「{novelTitle}」
        </span>
      )}
      <div className="spacer" />
      <Link to="/guide" style={{ fontSize: 13, color: 'var(--text-soft)' }}>
        KDP出版ガイド
      </Link>
      {right}
    </div>
  );
}
