import type { ReactElement } from 'react';
import { motion } from 'framer-motion';

type Variant = 'novels' | 'characters' | 'plot' | 'chapter' | 'fourAct';

const floatTransition = {
  duration: 3.2,
  repeat: Infinity,
  ease: 'easeInOut' as const,
};

function NovelsIllustration() {
  return (
    <svg width="140" height="120" viewBox="0 0 140 120" fill="none">
      <motion.g
        animate={{ y: [0, -6, 0] }}
        transition={floatTransition}
      >
        <rect x="24" y="66" width="46" height="34" rx="3" fill="var(--accent-bg)" stroke="var(--accent)" strokeWidth="2" />
        <rect x="70" y="66" width="46" height="34" rx="3" fill="var(--accent-bg)" stroke="var(--accent)" strokeWidth="2" />
        <path d="M70 66 L70 100" stroke="var(--accent)" strokeWidth="2" />
      </motion.g>
      <motion.g
        animate={{ rotate: [-8, 6, -8], x: [0, 3, 0] }}
        transition={{ ...floatTransition, duration: 2.4 }}
        style={{ transformOrigin: '112px 40px' }}
      >
        <path d="M112 40 L100 68 L108 71 L120 43 Z" fill="var(--accent)" />
        <path d="M100 68 L96 78 L106 74 Z" fill="#f2c94c" />
      </motion.g>
      <motion.circle
        cx="30"
        cy="30"
        r="3"
        fill="var(--accent-2)"
        animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.circle
        cx="46"
        cy="18"
        r="2"
        fill="var(--accent)"
        animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.2, 0.8] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay: 0.6 }}
      />
    </svg>
  );
}

function CharactersIllustration() {
  return (
    <svg width="140" height="120" viewBox="0 0 140 120" fill="none">
      {[0, 1, 2].map((i) => (
        <motion.g
          key={i}
          animate={{ y: [0, -8, 0] }}
          transition={{ ...floatTransition, delay: i * 0.25, duration: 2.6 + i * 0.3 }}
        >
          <circle cx={40 + i * 30} cy={46} r="14" fill="var(--accent-bg)" stroke="var(--accent)" strokeWidth="2" />
          <path
            d={`M${22 + i * 30} 92 Q${40 + i * 30} 62 ${58 + i * 30} 92 Z`}
            fill="var(--accent-bg)"
            stroke="var(--accent)"
            strokeWidth="2"
          />
        </motion.g>
      ))}
    </svg>
  );
}

function PlotIllustration() {
  return (
    <svg width="140" height="120" viewBox="0 0 140 120" fill="none">
      <motion.path
        d="M20 80 Q45 20 70 60 T120 40"
        stroke="var(--accent)"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
        strokeDasharray="6 8"
        animate={{ strokeDashoffset: [0, -28] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
      />
      {[
        [20, 80],
        [70, 60],
        [120, 40],
      ].map(([cx, cy], i) => (
        <motion.circle
          key={i}
          cx={cx}
          cy={cy}
          r="6"
          fill="var(--accent)"
          animate={{ scale: [1, 1.3, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.3, ease: 'easeInOut' }}
        />
      ))}
    </svg>
  );
}

function ChapterIllustration() {
  return (
    <svg width="120" height="100" viewBox="0 0 120 100" fill="none">
      <rect x="30" y="20" width="60" height="70" rx="4" fill="var(--accent-bg)" stroke="var(--accent)" strokeWidth="2" />
      <motion.g
        animate={{ x: [-10, -2, -10], opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <path d="M18 55 L6 55 M6 55 L12 49 M6 55 L12 61" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </motion.g>
    </svg>
  );
}

function FourActIllustration() {
  const labels = ['起', '承', '転', '結'];
  return (
    <svg width="160" height="80" viewBox="0 0 160 80" fill="none">
      {labels.map((label, i) => (
        <motion.g
          key={label}
          animate={{ y: [0, -5, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
        >
          <circle cx={24 + i * 38} cy={36} r="17" fill="var(--accent-bg)" stroke="var(--accent)" strokeWidth="1.5" />
          <text
            x={24 + i * 38}
            y={42}
            textAnchor="middle"
            fontSize="15"
            fill="var(--accent)"
            fontWeight={700}
          >
            {label}
          </text>
        </motion.g>
      ))}
    </svg>
  );
}

const ILLUSTRATIONS: Record<Variant, () => ReactElement> = {
  novels: NovelsIllustration,
  characters: CharactersIllustration,
  plot: PlotIllustration,
  chapter: ChapterIllustration,
  fourAct: FourActIllustration,
};

export default function EmptyIllustration({ variant }: { variant: Variant }) {
  const Illustration = ILLUSTRATIONS[variant];
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
      style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}
    >
      <Illustration />
    </motion.div>
  );
}
