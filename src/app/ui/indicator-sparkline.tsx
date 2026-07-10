import type { IndicatorObservation } from '@/lib/types';

interface SparklineProps {
  history: IndicatorObservation[];
  width?: number;
  height?: number;
  className?: string;
}

function trendLabel(values: number[]) {
  if (values.length < 2) return '관측치 1개';
  const delta = values.at(-1)! - values[0];
  if (Math.abs(delta) < Number.EPSILON) return '보합 추세';
  return delta > 0 ? '상승 추세' : '하락 추세';
}

export default function Sparkline({ history, width = 104, height = 36, className = '' }: SparklineProps) {
  const values = history.map((item) => item.value).filter(Number.isFinite);
  const padding = 3;
  const drawableWidth = Math.max(1, width - padding * 2);
  const drawableHeight = Math.max(1, height - padding * 2);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const spread = max - min;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : padding + (index / (values.length - 1)) * drawableWidth;
    const y = spread === 0 ? height / 2 : padding + ((max - value) / spread) * drawableHeight;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  const label = `최근 ${values.length}개 관측치, ${trendLabel(values)}`;

  return <svg
    className={`indicatorSparkline ${className}`.trim()}
    width={width}
    height={height}
    viewBox={`0 0 ${width} ${height}`}
    role="img"
    aria-label={label}
  >
    <title>{label}</title>
    {values.length === 0 ? <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} className="sparklineEmpty" />
      : values.length === 1 ? <circle cx={width / 2} cy={height / 2} r="2.5" className="sparklineDot" />
        : <>
          <polyline points={points} className="sparklineLine" />
          <circle
            cx={Number(points.split(' ').at(-1)!.split(',')[0])}
            cy={Number(points.split(' ').at(-1)!.split(',')[1])}
            r="2.25"
            className="sparklineDot"
          />
        </>}
  </svg>;
}
