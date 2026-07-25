export interface Chapter {
  id: string;
  title: string;
  content: string; // 本文（プレーンテキスト、段落は改行区切り）
  order: number;
  memo: string;
  createdAt: number;
  updatedAt: number;
}

export interface Character {
  id: string;
  name: string;
  kana: string;
  role: string; // 主人公・敵役・脇役 など
  summary: string;
  details: string;
  order: number;
}

export type PlotStatus = 'idea' | 'todo' | 'doing' | 'done';

export interface PlotPoint {
  id: string;
  title: string;
  detail: string;
  status: PlotStatus;
  order: number;
}

export interface WritingGoal {
  dailyWordTarget: number;
  totalWordTarget: number;
}

export interface WritingLogEntry {
  date: string; // YYYY-MM-DD
  words: number;
}

export interface ProgressBaseline {
  date: string; // YYYY-MM-DD
  chars: number;
}

export type TrimSize = 'pocket' | 'a5' | 'b6' | 'kindle';

export interface Novel {
  id: string;
  title: string;
  author: string;
  penName: string;
  synopsis: string;
  genre: string;
  coverColor: string;
  trimSize: TrimSize;
  chapters: Chapter[];
  characters: Character[];
  plotPoints: PlotPoint[];
  goal: WritingGoal;
  writingLog: WritingLogEntry[];
  progressBaseline: ProgressBaseline;
  createdAt: number;
  updatedAt: number;
}

export function createEmptyNovel(id: string, title: string): Novel {
  const now = Date.now();
  return {
    id,
    title,
    author: '',
    penName: '',
    synopsis: '',
    genre: '',
    coverColor: '#3b3268',
    trimSize: 'kindle',
    chapters: [
      {
        id: crypto.randomUUID(),
        title: '第一章',
        content: '',
        order: 0,
        memo: '',
        createdAt: now,
        updatedAt: now,
      },
    ],
    characters: [],
    plotPoints: [],
    goal: { dailyWordTarget: 1000, totalWordTarget: 80000 },
    writingLog: [],
    progressBaseline: { date: '', chars: 0 },
    createdAt: now,
    updatedAt: now,
  };
}
