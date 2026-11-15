import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { LayerKey, NASA_GIBS_LAYERS } from '../types/bea';
import { BeaThemePalette, resolveTheme } from '../theme/themes';

export interface CorrelationSamplePoint {
  id: string;
  dateStr: string;
  layerKey: LayerKey;
  brightness: number;
  climateAnomaly: number;
  isCurrentFrame: boolean;
}

export interface PearsonCorrelationStats {
  n: number;
  r: number;
  rSquared: number;
  slope: number;
  intercept: number;
  meanX: number;
  meanY: number;
  hasVariance: boolean;
  polarity: 'positive' | 'negative' | 'neutral';
  strengthLabel: string;
}

export function computePearsonCorrelation(
  points: CorrelationSamplePoint[]
): PearsonCorrelationStats {
  const n = points.length;
  if (n < 2) {
    const x0 = points[0]?.brightness ?? 0;
    const y0 = points[0]?.climateAnomaly ?? 0;
    return {
      n,
      r: 0,
      rSquared: 0,
      slope: 0,
      intercept: y0,
      meanX: x0,
      meanY: y0,
      hasVariance: false,
      polarity: 'neutral',
      strengthLabel: 'NEED ≥2 PTS',
    };
  }

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += points[i].brightness;
    sumY += points[i].climateAnomaly;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = points[i].brightness - meanX;
    const dy = points[i].climateAnomaly - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  const denom = Math.sqrt(sxx * syy);
  if (denom < 1e-9 || sxx < 1e-9) {
    return {
      n,
      r: 0,
      rSquared: 0,
      slope: 0,
      intercept: meanY,
      meanX,
      meanY,
      hasVariance: false,
      polarity: 'neutral',
      strengthLabel: 'FLAT VARIANCE',
    };
  }

  const rawR = sxy / denom;
  const r = Math.max(-1, Math.min(1, rawR));
  const rSquared = r * r;
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const absR = Math.abs(r);

  const polarity: PearsonCorrelationStats['polarity'] =
    r >= 0.15 ? 'positive' : r <= -0.15 ? 'negative' : 'neutral';

  let strengthLabel = 'NEUTRAL';
  if (absR >= 0.7) {
    strengthLabel = polarity === 'positive' ? 'STRONG +' : 'STRONG −';
  } else if (absR >= 0.4) {
    strengthLabel = polarity === 'positive' ? 'MODERATE +' : 'MODERATE −';
  } else if (absR >= 0.15) {
    strengthLabel = polarity === 'positive' ? 'WEAK +' : 'WEAK −';
  }

  return {
    n,
    r,
    rSquared,
    slope,
    intercept,
    meanX,
    meanY,
    hasVariance: true,
    polarity,
    strengthLabel,
  };
}

interface SignalCorrelationPlotProps {
  points: CorrelationSamplePoint[];
  stats: PearsonCorrelationStats;
  activeLayerKey: LayerKey;
  nightMode?: boolean;
  theme?: BeaThemePalette;
}

const PLOT_HEIGHT = 158;
const MARGIN = { top: 14, right: 16, bottom: 26, left: 36 };

export const SignalCorrelationPlot: React.FC<SignalCorrelationPlotProps> = ({
  points,
  stats,
  activeLayerKey,
  nightMode = false,
  theme,
}) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [plotWidth, setPlotWidth] = useState<number>(380);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const w = Math.max(240, Math.round(el.getBoundingClientRect().width));
      setPlotWidth((prev) => (prev === w ? prev : w));
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const innerW = Math.max(80, plotWidth - MARGIN.left - MARGIN.right);
  const innerH = Math.max(60, PLOT_HEIGHT - MARGIN.top - MARGIN.bottom);

  const xScale = useMemo(() => d3.scaleLinear().domain([0, 1]).range([0, innerW]), [innerW]);
  const yScale = useMemo(() => d3.scaleLinear().domain([0, 1]).range([innerH, 0]), [innerH]);

  const ticks = useMemo(() => [0, 0.25, 0.5, 0.75, 1.0], []);

  const regressionSegment = useMemo(() => {
    if (!stats.hasVariance) return null;
    // Clip line y = slope * x + intercept cleanly inside [0, 1] x [0, 1]
    const candidates: Array<[number, number]> = [];
    const yAt0 = stats.intercept;
    if (yAt0 >= 0 && yAt0 <= 1) candidates.push([0, yAt0]);
    const yAt1 = stats.slope + stats.intercept;
    if (yAt1 >= 0 && yAt1 <= 1) candidates.push([1, yAt1]);

    if (Math.abs(stats.slope) > 1e-6) {
      const xAt0 = (0 - stats.intercept) / stats.slope;
      if (xAt0 > 0 && xAt0 < 1) candidates.push([xAt0, 0]);
      const xAt1 = (1 - stats.intercept) / stats.slope;
      if (xAt1 > 0 && xAt1 < 1) candidates.push([xAt1, 1]);
    }

    if (candidates.length < 2) return null;
    candidates.sort((a, b) => a[0] - b[0]);
    const pStart = candidates[0];
    const pEnd = candidates[candidates.length - 1];
    const pathGen = d3
      .line<[number, number]>()
      .x((d) => xScale(d[0]))
      .y((d) => yScale(d[1]));

    return pathGen([pStart, pEnd]);
  }, [stats, xScale, yScale]);

  const palette = useMemo(() => {
    const c = resolveTheme(theme, nightMode).canvas;
    return {
      bg: c.bg,
      grid: c.gridLine,
      axis: c.borderStrong,
      textMuted: c.textMuted,
      textPrimary: c.textPrimary,
      mint: c.primary,
      coral: c.secondary,
      amber: c.tertiary,
      scatterLayers: c.scatterLayers,
    };
  }, [nightMode, theme]);

  const trendColor =
    stats.polarity === 'positive'
      ? palette.mint
      : stats.polarity === 'negative'
      ? palette.coral
      : palette.textMuted;

  const getLayerColor = (layerKey: LayerKey): string => palette.scatterLayers[layerKey];

  const hoveredPoint = useMemo(
    () => (hoveredId ? points.find((p) => p.id === hoveredId) ?? null : null),
    [hoveredId, points]
  );

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left - MARGIN.left;
    const my = e.clientY - rect.top - MARGIN.top;

    let closestId: string | null = null;
    let bestDist = 18; // max snap radius in px
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const px = xScale(pt.brightness);
      const py = yScale(pt.climateAnomaly);
      const d = Math.hypot(px - mx, py - my);
      if (d <= bestDist) {
        bestDist = d;
        closestId = pt.id;
      }
    }
    setHoveredId(closestId);
  };

  return (
    <div className="border border-[var(--border-strong)] bg-[var(--bg-console)] p-2.5 flex flex-col gap-2">
      {/* Compact quantitative statistics header */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-tabular">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[var(--text-primary)] font-semibold uppercase tracking-wider truncate">
            Brightness × Anomaly
          </span>
          <span className="text-[var(--text-muted)] shrink-0">n={stats.n}</span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 tabular-nums">
          <span className="text-[var(--text-muted)]">
            R²{' '}
            <strong className="text-[var(--text-primary)]">
              {stats.rSquared.toFixed(2)}
            </strong>
          </span>
          <span
            className="font-semibold"
            style={{ color: trendColor }}
            aria-label={`Pearson correlation r equals ${stats.r.toFixed(3)}, ${stats.strengthLabel}`}
          >
            r = {stats.r >= 0 ? '+' : ''}
            {stats.r.toFixed(3)} · {stats.strengthLabel}
          </span>
        </div>
      </div>

      {/* Responsive D3 Scatter Plot SVG */}
      <div
        ref={wrapRef}
        className="relative w-full border border-[var(--border-grid)] bg-[var(--bg-obsidian)]"
        style={{ height: `${PLOT_HEIGHT}px` }}
      >
        <svg
          width={plotWidth}
          height={PLOT_HEIGHT}
          role="img"
          aria-label={`D3 Pearson correlation scatter plot between Brightness (x) and Climate Anomaly (y). r = ${stats.r.toFixed(
            3
          )}, ${stats.strengthLabel}, ${stats.n} samples.`}
          className="block w-full h-full cursor-crosshair select-none"
          onMouseMove={handleSvgMouseMove}
          onMouseLeave={() => setHoveredId(null)}
        >
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {/* Subtle grid lines */}
            {ticks.map((t) => (
              <g key={`grid-${t}`}>
                <line
                  x1={xScale(t)}
                  x2={xScale(t)}
                  y1={0}
                  y2={innerH}
                  stroke={palette.grid}
                  strokeWidth={1}
                  strokeDasharray={t === 0 || t === 1 ? undefined : '2,2'}
                />
                <line
                  x1={0}
                  x2={innerW}
                  y1={yScale(t)}
                  y2={yScale(t)}
                  stroke={palette.grid}
                  strokeWidth={1}
                  strokeDasharray={t === 0 || t === 1 ? undefined : '2,2'}
                />
              </g>
            ))}

            {/* Sample centroid crosshair (meanX, meanY) */}
            {stats.n >= 2 && (
              <g opacity={0.45}>
                <line
                  x1={xScale(stats.meanX)}
                  x2={xScale(stats.meanX)}
                  y1={0}
                  y2={innerH}
                  stroke={palette.amber}
                  strokeWidth={1}
                  strokeDasharray="3,3"
                />
                <line
                  x1={0}
                  x2={innerW}
                  y1={yScale(stats.meanY)}
                  y2={yScale(stats.meanY)}
                  stroke={palette.amber}
                  strokeWidth={1}
                  strokeDasharray="3,3"
                />
              </g>
            )}

            {/* OLS Linear Regression Trendline */}
            {regressionSegment && (
              <path
                d={regressionSegment}
                fill="none"
                stroke={trendColor}
                strokeWidth={1.75}
                strokeDasharray="5,3"
              />
            )}

            {/* Axes & Numeric Ticks */}
            <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke={palette.axis} strokeWidth={1} />
            <line x1={0} x2={0} y1={0} y2={innerH} stroke={palette.axis} strokeWidth={1} />

            {[0, 0.5, 1].map((t) => (
              <g key={`tick-x-${t}`} transform={`translate(${xScale(t)},${innerH})`}>
                <line y1={0} y2={4} stroke={palette.axis} strokeWidth={1} />
                <text
                  y={14}
                  textAnchor={t === 0 ? 'start' : t === 1 ? 'end' : 'middle'}
                  fill={palette.textMuted}
                  fontSize={9}
                  fontFamily='"JetBrains Mono", monospace'
                >
                  {t.toFixed(1)}
                </text>
              </g>
            ))}

            {[0, 0.5, 1].map((t) => (
              <g key={`tick-y-${t}`} transform={`translate(0,${yScale(t)})`}>
                <line x1={-4} x2={0} stroke={palette.axis} strokeWidth={1} />
                <text
                  x={-6}
                  dy="0.32em"
                  textAnchor="end"
                  fill={palette.textMuted}
                  fontSize={9}
                  fontFamily='"JetBrains Mono", monospace'
                >
                  {t.toFixed(1)}
                </text>
              </g>
            ))}

            {/* Axis Labels */}
            <text
              x={innerW / 2}
              y={innerH + 22}
              textAnchor="middle"
              fill={palette.textMuted}
              fontSize={9}
              fontFamily='"JetBrains Mono", monospace'
              letterSpacing="0.06em"
            >
              BRIGHTNESS (0.0–1.0)
            </text>
            <text
              transform={`translate(-26, ${innerH / 2}) rotate(-90)`}
              textAnchor="middle"
              fill={palette.textMuted}
              fontSize={9}
              fontFamily='"JetBrains Mono", monospace'
              letterSpacing="0.06em"
            >
              ANOMALY
            </text>

            {/* Historical / Non-current-frame Telemetry Points */}
            {points
              .filter((p) => !p.isCurrentFrame)
              .map((pt) => {
                const cx = xScale(pt.brightness);
                const cy = yScale(pt.climateAnomaly);
                const col = getLayerColor(pt.layerKey);
                const isHov = hoveredId === pt.id;
                return (
                  <rect
                    key={pt.id}
                    x={cx - (isHov ? 3.5 : 2.5)}
                    y={cy - (isHov ? 3.5 : 2.5)}
                    width={isHov ? 7 : 5}
                    height={isHov ? 7 : 5}
                    fill={col}
                    fillOpacity={isHov ? 0.95 : 0.45}
                    stroke={isHov ? palette.textPrimary : col}
                    strokeWidth={isHov ? 1.2 : 0.75}
                  />
                );
              })}

            {/* Current Frame Cardinal Layer Points (N, E, S, W) */}
            {points
              .filter((p) => p.isCurrentFrame)
              .map((pt) => {
                const cx = xScale(pt.brightness);
                const cy = yScale(pt.climateAnomaly);
                const col = getLayerColor(pt.layerKey);
                const isActive = pt.layerKey === activeLayerKey;
                const isHov = hoveredId === pt.id;
                const shortTag = NASA_GIBS_LAYERS[pt.layerKey].shortCardinal;

                return (
                  <g key={pt.id} transform={`translate(${cx},${cy})`}>
                    {(isActive || isHov) && (
                      <rect
                        x={-6.5}
                        y={-6.5}
                        width={13}
                        height={13}
                        fill="none"
                        stroke={palette.textPrimary}
                        strokeWidth={1.2}
                      />
                    )}
                    <rect
                      x={-3.5}
                      y={-3.5}
                      width={7}
                      height={7}
                      transform={isActive ? 'rotate(45)' : undefined}
                      fill={col}
                      stroke={palette.bg}
                      strokeWidth={1}
                    />
                    <text
                      x={cx > innerW - 22 ? -8 : 7}
                      y={cy < 14 ? 9 : -4}
                      textAnchor={cx > innerW - 22 ? 'end' : 'start'}
                      fill={isActive ? palette.textPrimary : col}
                      fontSize={9}
                      fontWeight={isActive ? 700 : 600}
                      fontFamily='"JetBrains Mono", monospace'
                    >
                      {shortTag}
                    </text>
                  </g>
                );
              })}
          </g>
        </svg>

        {/* Precision Hover Point Probe */}
        {hoveredPoint && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-1.5 right-1.5 border border-[var(--border-strong)] bg-[var(--bg-obsidian)]/95 px-2 py-1 text-[10px] font-mono-tabular text-[var(--text-primary)] whitespace-nowrap"
          >
            <span style={{ color: getLayerColor(hoveredPoint.layerKey) }} className="font-semibold">
              {NASA_GIBS_LAYERS[hoveredPoint.layerKey].shortCardinal}
            </span>{' '}
            · {hoveredPoint.dateStr} · B {hoveredPoint.brightness.toFixed(3)} · A{' '}
            {hoveredPoint.climateAnomaly.toFixed(3)}
          </div>
        )}
      </div>

      {/* Cardinal Point Color Key */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono-tabular text-[var(--text-muted)]">
        <div className="flex items-center gap-2.5 flex-wrap">
          {(['north', 'east', 'south', 'west'] as LayerKey[]).map((key) => {
            const meta = NASA_GIBS_LAYERS[key];
            const isActive = key === activeLayerKey;
            return (
              <span
                key={key}
                className={`inline-flex items-center gap-1 whitespace-nowrap ${
                  isActive ? 'text-[var(--text-primary)] font-semibold' : ''
                }`}
              >
                <span
                  className="inline-block w-2 h-2"
                  style={{ backgroundColor: getLayerColor(key) }}
                  aria-hidden="true"
                />
                {meta.shortCardinal} {meta.domain}
              </span>
            );
          })}
        </div>
        <span className="whitespace-nowrap">DASHED = OLS FIT</span>
      </div>
    </div>
  );
};
