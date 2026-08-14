import { useEffect, useRef } from 'react';

interface Props {
  width: number;
  height: number;
  /** 絵を描く処理。依存する値が変わるたびに描き直す。 */
  paint: (canvas: HTMLCanvasElement) => void;
  className?: string;
  alt?: string;
}

/**
 * その場で絵を描くキャンバス。
 * 画面に見えている絵と、書き出しに入る絵は、まったく同じ手続きで作る。
 */
export default function ArtCanvas({ width, height, paint, className, alt }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    paint(canvas);
  }, [width, height, paint]);

  return <canvas ref={ref} className={className} role="img" aria-label={alt} />;
}
