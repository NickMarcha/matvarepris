import { useMemo, useRef, useState } from "react";

interface Point {
  x: Date;
  y: number;
}

interface LineChartProps {
  points: Point[];
  color: string;
  unitLabel: string;
  width?: number;
  height?: number;
}

const PADDING = { top: 12, right: 12, bottom: 24, left: 44 };

export function LineChart({ points, color, unitLabel, width = 560, height = 160 }: LineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { path, scaleX, scaleY, minY, maxY } = useMemo(() => {
    if (points.length === 0) {
      return { path: "", scaleX: (_: number) => 0, scaleY: (_: number) => 0, minY: 0, maxY: 0 };
    }
    const xs = points.map((p) => p.x.getTime());
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const yPad = (maxY - minY) * 0.1 || 1;
    const plotW = width - PADDING.left - PADDING.right;
    const plotH = height - PADDING.top - PADDING.bottom;

    const sx = (t: number) => PADDING.left + (maxX === minX ? plotW / 2 : ((t - minX) / (maxX - minX)) * plotW);
    const sy = (v: number) =>
      PADDING.top + plotH - ((v - (minY - yPad)) / (maxY - minY + yPad * 2 || 1)) * plotH;

    const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x.getTime())} ${sy(p.y)}`).join(" ");
    return { path: d, scaleX: sx, scaleY: sy, minY, maxY };
  }, [points, width, height]);

  if (points.length === 0) {
    return <div className="loading-state">No history yet — check back after the next refresh.</div>;
  }

  if (points.length === 1) {
    return (
      <div className="loading-state">
        Only one data point so far ({points[0].y.toFixed(2)} {unitLabel}). Come back after prices change.
      </div>
    );
  }

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = ((e.clientX - rect.left) / rect.width) * width;
    let closest = 0;
    let closestDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(scaleX(p.x.getTime()) - mouseX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    setHoverIndex(closest);
  }

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      onMouseMove={handleMove}
      onMouseLeave={() => setHoverIndex(null)}
      style={{ overflow: "visible" }}
    >
      {/* gridlines */}
      {[minY, (minY + maxY) / 2, maxY].map((v, i) => (
        <g key={i}>
          <line
            x1={PADDING.left}
            x2={width - PADDING.right}
            y1={scaleY(v)}
            y2={scaleY(v)}
            stroke="var(--gridline)"
            strokeWidth={1}
          />
          <text x={PADDING.left - 8} y={scaleY(v) + 3} textAnchor="end" fontSize={10} fill="var(--text-muted)">
            {v.toFixed(v < 10 ? 2 : 0)}
          </text>
        </g>
      ))}

      {/* baseline */}
      <line
        x1={PADDING.left}
        x2={width - PADDING.right}
        y1={height - PADDING.bottom}
        y2={height - PADDING.bottom}
        stroke="var(--baseline)"
        strokeWidth={1}
      />

      {/* date labels */}
      <text x={PADDING.left} y={height - 6} fontSize={10} fill="var(--text-muted)">
        {points[0].x.toLocaleDateString("no-NO")}
      </text>
      <text x={width - PADDING.right} y={height - 6} textAnchor="end" fontSize={10} fill="var(--text-muted)">
        {points[points.length - 1].x.toLocaleDateString("no-NO")}
      </text>

      {/* line */}
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

      {/* points */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={scaleX(p.x.getTime())}
          cy={scaleY(p.y)}
          r={hoverIndex === i ? 4 : 2.5}
          fill={color}
          stroke="var(--surface)"
          strokeWidth={1}
        />
      ))}

      {/* crosshair + tooltip */}
      {hovered && (
        <g>
          <line
            x1={scaleX(hovered.x.getTime())}
            x2={scaleX(hovered.x.getTime())}
            y1={PADDING.top}
            y2={height - PADDING.bottom}
            stroke="var(--text-muted)"
            strokeWidth={1}
            strokeDasharray="3,3"
          />
          <g transform={`translate(${Math.min(Math.max(scaleX(hovered.x.getTime()), 60), width - 70)}, ${PADDING.top})`}>
            <rect x={-55} y={-2} width={110} height={34} rx={6} fill="var(--surface)" stroke="var(--border)" />
            <text x={0} y={11} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--text-primary)">
              {hovered.y.toFixed(2)} {unitLabel}
            </text>
            <text x={0} y={24} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
              {hovered.x.toLocaleDateString("no-NO")}
            </text>
          </g>
        </g>
      )}
    </svg>
  );
}
