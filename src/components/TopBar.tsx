import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useInstallPrompt } from '../lib/useInstallPrompt';

interface Props {
  novelId?: string;
  novelTitle?: string;
  right?: ReactNode;
  activeTab?: 'write' | 'characters' | 'plot' | 'export';
}

const TABS: { key: NonNullable<Props['activeTab']>; label: string; path: (id: string) => string }[] = [
  { key: 'write', label: '執筆', path: (id) => `/novel/${id}` },
  { key: 'characters', label: 'キャラクター', path: (id) => `/novel/${id}/characters` },
  { key: 'plot', label: 'プロット', path: (id) => `/novel/${id}/plot` },
  { key: 'export', label: '出版準備', path: (id) => `/novel/${id}/export` },
];

export default function TopBar({ novelId, novelTitle, right, activeTab }: Props) {
  const { canInstall, promptInstall } = useInstallPrompt();
  return (
    <div className="topbar">
      <Link to="/" className="brand">
        <span className="logo-dot" />
        小説執筆スタジオ
      </Link>
      {novelId && (
        <nav className="nav-tabs">
          {TABS.map((tab) => (
            <Link
              key={tab.key}
              to={tab.path(novelId)}
              className={activeTab === tab.key ? 'active' : ''}
              style={{ position: 'relative' }}
            >
              {activeTab === tab.key && (
                <motion.span
                  layoutId="nav-pill"
                  className="nav-pill"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <span style={{ position: 'relative', zIndex: 1 }}>{tab.label}</span>
            </Link>
          ))}
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
      {canInstall && (
        <motion.button
          className="btn btn-sm btn-primary"
          onClick={promptInstall}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.95 }}
        >
          📲 インストール
        </motion.button>
      )}
      {right}
    </div>
  );
}
