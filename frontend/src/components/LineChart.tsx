import { useMemo, useRef, useState } from "react";

interface Point {
  x: Date;
  y: number;
}

export interface ChartSeries {
  label: string;
  color: string;
  points: Point[];
}

interface LineChartProps {
  series: ChartSeries[];
  unitLabel: string;
  width?: number;
  height?: number;
}

const PADDING = { top: 12, right: 12, bottom: 24, left: 44 };

// Price is a step function (constant between change events, not
// interpolated) — for a given series, the value "at" any time t is whatever
// it last changed to at-or-before t, falling back to the earliest known
// value if t is before the series' first recorded point.
function valueAtOrBefore(points: Point[], t: number): number | null {
  let result: number | null = null;
  for (const p of points) {
    if (p.x.getTime() <= t) result = p.y;
    else break;
  }
  return result ?? points[0]?.y ?? null;
}

export function LineChart({ series, unitLabel, width = 560, height = 160 }: LineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  const plottableSeries = series.filter((s) => s.points.length > 0);

  const { paths, scaleX, scaleY, minY, maxY, minX, maxX } = useMemo(() => {
    const allPoints = plottableSeries.flatMap((s) => s.points);
    if (allPoints.length === 0) {
      return {
        paths: [] as { series: ChartSeries; d: string }[],
        scaleX: (_: number) => 0,
        scaleY: (_: number) => 0,
        minY: 0,
        maxY: 0,
        minX: 0,
        maxX: 0,
      };
    }
    const xs = allPoints.map((p) => p.x.getTime());
    const ys = allPoints.map((p) => p.y);
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

    const paths = plottableSeries
      .filter((s) => s.points.length >= 2)
      .map((s) => ({
        series: s,
        d: s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x.getTime())} ${sy(p.y)}`).join(" "),
      }));

    return { paths, scaleX: sx, scaleY: sy, minY, maxY, minX, maxX };
  }, [plottableSeries, width, height]);

  if (plottableSeries.length === 0) {
    return <div className="loading-state">Ingen prishistorikk ennå — sjekk igjen etter neste oppdatering.</div>;
  }

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = ((e.clientX - rect.left) / rect.width) * width;
    let closestTime: number | null = null;
    let closestDist = Infinity;
    for (const s of plottableSeries) {
      for (const p of s.points) {
        const dist = Math.abs(scaleX(p.x.getTime()) - mouseX);
        if (dist < closestDist) {
          closestDist = dist;
          closestTime = p.x.getTime();
        }
      }
    }
    setHoverTime(closestTime);
  }

  const tooltipRows = hoverTime !== null
    ? plottableSeries.map((s) => ({ series: s, value: valueAtOrBefore(s.points, hoverTime) }))
    : [];
  const tooltipHeight = 16 + tooltipRows.length * 14 + 6;

  return (
    <>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverTime(null)}
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
          {new Date(minX).toLocaleDateString("no-NO")}
        </text>
        <text x={width - PADDING.right} y={height - 6} textAnchor="end" fontSize={10} fill="var(--text-muted)">
          {new Date(maxX).toLocaleDateString("no-NO")}
        </text>

        {/* lines */}
        {paths.map(({ series: s, d }) => (
          <path
            key={s.label}
            d={d}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* points */}
        {plottableSeries.map((s) =>
          s.points.map((p, i) => (
            <circle
              key={`${s.label}-${i}`}
              cx={scaleX(p.x.getTime())}
              cy={scaleY(p.y)}
              r={hoverTime === p.x.getTime() ? 4 : 2.5}
              fill={s.color}
              stroke="var(--surface)"
              strokeWidth={1}
            />
          )),
        )}

        {/* crosshair + tooltip */}
        {hoverTime !== null && (
          <g>
            <line
              x1={scaleX(hoverTime)}
              x2={scaleX(hoverTime)}
              y1={PADDING.top}
              y2={height - PADDING.bottom}
              stroke="var(--text-muted)"
              strokeWidth={1}
              strokeDasharray="3,3"
            />
            <g transform={`translate(${Math.min(Math.max(scaleX(hoverTime), 60), width - 70)}, ${PADDING.top})`}>
              <rect x={-58} y={-2} width={116} height={tooltipHeight} rx={6} fill="var(--surface)" stroke="var(--border)" />
              <text x={0} y={11} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
                {new Date(hoverTime).toLocaleDateString("no-NO")}
              </text>
              {tooltipRows.map(({ series: s, value }, i) => (
                <text
                  key={s.label}
                  x={0}
                  y={24 + i * 14}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill={s.color}
                >
                  {value !== null ? `${value.toFixed(2)} ${unitLabel}` : "—"} ({s.label})
                </text>
              ))}
            </g>
          </g>
        )}
      </svg>

      {plottableSeries.length > 1 && (
        <div className="chart-legend">
          {plottableSeries.map((s) => (
            <span key={s.label} className="chart-legend-item">
              <span className="chart-legend-swatch" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
