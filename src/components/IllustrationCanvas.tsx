import { useEffect, useRef } from 'react';
import type { Novel } from '../types';
import { drawChapterIllustrationToCanvas } from '../lib/coverGenerator';

interface Props {
  novel: Novel;
  chapterTitle: string;
  index: number;
  width: number;
  height: number;
  className?: string;
}

export default function IllustrationCanvas({
  novel,
  chapterTitle,
  index,
  width,
  height,
  className,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    drawChapterIllustrationToCanvas(canvas, novel, chapterTitle, index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novel.title, novel.genre, chapterTitle, index, width, height]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      className={className}
      style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
    />
  );
}
