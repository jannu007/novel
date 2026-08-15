/**
 * 本の中身から描いた表紙を受け取るためのフック。
 * 描き上がるまでは null（そのあいだは題名から決まる表紙を出す）。
 */

import { useEffect, useState } from 'react';
import { bookCoverUrl } from './cover';
import type { BookRecord } from './db';

export function useBookCover(book: BookRecord | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!book) return;
    let alive = true;
    bookCoverUrl(book).then((found) => {
      if (alive) setUrl(found);
    });
    return () => {
      alive = false;
    };
  }, [book]);
  return url;
}
