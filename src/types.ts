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

/**
 * 用語集の項目（地名・組織・固有名詞など）。
 * 表記と読みを一か所に集めておくと、長編でも設定がぶれにくくなる。
 */
export interface Term {
  id: string;
  name: string;
  reading: string;
  description: string;
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
  trimSize: TrimSize;
  illustrationsEnabled: boolean;
  chapters: Chapter[];
  characters: Character[];
  plotPoints: PlotPoint[];
  /** 用語集（「文机」で追加。従来アプリでは未使用のため任意） */
  terms?: Term[];
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
    trimSize: 'kindle',
    illustrationsEnabled: true,
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
    terms: [],
    goal: { dailyWordTarget: 1000, totalWordTarget: 80000 },
    writingLog: [],
    progressBaseline: { date: '', chars: 0 },
    createdAt: now,
    updatedAt: now,
  };
}
