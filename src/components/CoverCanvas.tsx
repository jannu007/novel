import { useEffect, useRef } from 'react';
import type { Novel } from '../types';
import { drawCoverToCanvas } from '../lib/coverGenerator';

interface Props {
  novel: Novel;
  width: number;
  height: number;
  variation?: number;
  style?: React.CSSProperties;
  className?: string;
}

export default function CoverCanvas({
  novel,
  width,
  height,
  variation = 0,
  style,
  className,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    drawCoverToCanvas(canvas, novel, variation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novel.title, novel.genre, novel.author, novel.penName, variation, width, height]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      className={className}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        objectFit: 'cover',
        ...style,
      }}
    />
  );
}
