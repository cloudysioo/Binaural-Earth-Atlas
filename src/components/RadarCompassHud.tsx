import React, { useEffect, useRef } from 'react';
import { HeadingWindTelemetry } from '../analysis/windVectorField';
import { SpatialPanningMode } from '../audio/audioEngine';
import {
  azimuthToLayerKey,
  FeatureVector,
  LAYER_ORDER,
  LayerKey,
  NASA_GIBS_LAYERS,
} from '../types/bea';

interface RadarCompassHudProps {
  listenerAngle: number;
  activeLayerKey: LayerKey;
  vectors: Record<LayerKey, FeatureVector>;
  panningMode?: SpatialPanningMode;
  windTelemetry?: HeadingWindTelemetry | null;
  atmosphericFlowEnabled?: boolean;
  nightMode?: boolean;
  onChangeHeading: (angleDeg: number) => void;
  onSelectLayer: (layerKey: LayerKey) => void;
  onChangePanningMode?: (mode: SpatialPanningMode) => void;
}

export const RadarCompassHud: React.FC<RadarCompassHudProps> = ({
  listenerAngle,
  activeLayerKey,
  vectors,
  panningMode = 'smooth360',
  windTelemetry = null,
  atmosphericFlowEnabled = true,
  nightMode = false,
  onChangeHeading,
  onSelectLayer,
  onChangePanningMode,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);
  const latestPropsRef = useRef({
    listenerAngle,
    activeLayerKey,
    vectors,
    windTelemetry,
    atmosphericFlowEnabled,
    nightMode,
  });
  latestPropsRef.current = {
    listenerAngle,
    activeLayerKey,
    vectors,
    windTelemetry,
    atmosphericFlowEnabled,
    nightMode,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let rafId: number | null = null;
    let phase = 0;
    let lastTs = performance.now();

    const drawFrame = (now: number) => {
      const {
        listenerAngle: angle,
        activeLayerKey: activeKey,
        vectors: currentVectors,
        windTelemetry: currentWind,
        atmosphericFlowEnabled: flowOn,
        nightMode: isNightMode,
      } = latestPropsRef.current;

      const activeVec = currentVectors[activeKey];
      const activeEnergy = Math.min(
        1,
        0.3 * (activeVec?.brightness ?? 0) +
          0.2 * (activeVec?.saturation ?? 0) +
          0.25 * (activeVec?.edgeDensity ?? 0) +
          0.25 * (activeVec?.motion ?? 0)
      );
      const activeTension = activeVec?.climateAnomaly ?? 0;

      const dtSec = Math.min(0.1, Math.max(0, (now - lastTs) / 1000));
      lastTs = now;

      // Pulse cadence accelerates dynamically with active layer's Frame Motion & Edge Density
      const pulseHz =
        0.55 + (activeVec?.motion ?? 0) * 0.75 + (activeVec?.edgeDensity ?? 0) * 0.4;
      phase = prefersReducedMotion ? 0.35 : (phase + dtSec * pulseHz) % 1;

      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const maxR = 104;

      ctx.fillStyle = isNightMode ? '#070102' : '#060B14';
      ctx.fillRect(0, 0, w, h);

      // Concentric range rings
      ctx.strokeStyle = isNightMode ? 'rgba(77, 17, 25, 0.9)' : 'rgba(26, 46, 68, 0.9)';
      ctx.lineWidth = 1;
      for (const ratio of [0.33, 0.66, 1.0]) {
        ctx.beginPath();
        ctx.arc(cx, cy, maxR * ratio, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Tick marks every 15 degrees around compass perimeter
      for (let deg = 0; deg < 360; deg += 15) {
        const rad = ((deg - 90) * Math.PI) / 180;
        const inner = deg % 90 === 0 ? maxR - 8 : deg % 45 === 0 ? maxR - 5 : maxR - 3;
        ctx.strokeStyle =
          deg % 90 === 0
            ? isNightMode
              ? '#DC2626'
              : '#5EEAD4'
            : isNightMode
            ? 'rgba(185, 28, 28, 0.38)'
            : 'rgba(148, 163, 184, 0.35)';
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(rad) * inner, cy + Math.sin(rad) * inner);
        ctx.lineTo(cx + Math.cos(rad) * maxR, cy + Math.sin(rad) * maxR);
        ctx.stroke();
      }

      // Orthogonal axes
      ctx.strokeStyle = isNightMode ? 'rgba(77, 17, 25, 0.8)' : 'rgba(26, 46, 68, 0.8)';
      ctx.beginPath();
      ctx.moveTo(cx - maxR - 8, cy);
      ctx.lineTo(cx + maxR + 8, cy);
      ctx.moveTo(cx, cy - maxR - 8);
      ctx.lineTo(cx, cy + maxR + 8);
      ctx.stroke();

      // 45-degree translucent binaural listener orientation cone
      const headingRad = ((angle - 90) * Math.PI) / 180;
      const halfCone = (22.5 * Math.PI) / 180;

      ctx.save();
      ctx.fillStyle = isNightMode ? 'rgba(220, 38, 38, 0.14)' : 'rgba(94, 234, 212, 0.22)';
      ctx.strokeStyle = isNightMode ? '#DC2626' : '#5EEAD4';
      ctx.lineWidth = isNightMode ? 1.25 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, maxR, headingRad - halfCone, headingRad + halfCone);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = isNightMode ? '#FF3B30' : '#5EEAD4';
      ctx.lineWidth = isNightMode ? 1.5 : 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(headingRad) * maxR, cy + Math.sin(headingRad) * maxR);
      ctx.stroke();
      ctx.restore();

      // Atmospheric Flow oceanic wind intensity sweep arc & directional bearing tick
      if (currentWind && flowOn) {
        const windArcSpan = Math.max(0.08, currentWind.intensity * (Math.PI * 0.65));
        ctx.save();
        ctx.strokeStyle = currentWind.isHighWindOcean
          ? isNightMode
            ? 'rgba(255, 107, 74, 0.72)'
            : 'rgba(245, 158, 11, 0.85)'
          : isNightMode
          ? 'rgba(220, 38, 38, 0.45)'
          : 'rgba(56, 189, 248, 0.65)';
        ctx.lineWidth = isNightMode ? 1.6 : 2.2;
        ctx.beginPath();
        ctx.arc(cx, cy, maxR + 6, headingRad - windArcSpan, headingRad + windArcSpan);
        ctx.stroke();

        const windBearingRad = ((currentWind.bearingDeg - 90) * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(
          cx + Math.cos(windBearingRad) * (maxR + 3),
          cy + Math.sin(windBearingRad) * (maxR + 3)
        );
        ctx.lineTo(
          cx + Math.cos(windBearingRad) * (maxR + 10),
          cy + Math.sin(windBearingRad) * (maxR + 10)
        );
        ctx.stroke();
        ctx.restore();
      }

      // Animated HRTF-Focus pulses + targets at 12, 3, 6, and 9 o'clock positions
      const bloomScale = isNightMode ? 0.5 : 1.0;
      const radiusScale = isNightMode ? 0.72 : 1.0;

      LAYER_ORDER.forEach((key, idx) => {
        const meta = NASA_GIBS_LAYERS[key];
        const rad = ((meta.azimuth - 90) * Math.PI) / 180;
        const tx = cx + Math.cos(rad) * maxR;
        const ty = cy + Math.sin(rad) * maxR;
        const isActive = key === activeKey;
        const nodeAnomaly = currentVectors[key]?.climateAnomaly ?? 0;

        const delta = Math.abs(angle - meta.azimuth);
        const shortest = Math.min(delta, 360 - delta);
        const focusWeight = 0.45 + 0.55 * Math.max(0, Math.cos((shortest * Math.PI) / 180));

        // Dual concentric wavefronts scaled dynamically by active layer's feature vector & HRTF focus
        const baseColorRgb = isNightMode
          ? nodeAnomaly > 0.55 || (isActive && activeTension > 0.5)
            ? '255, 107, 74'
            : isActive
            ? '255, 59, 48'
            : '185, 28, 28'
          : nodeAnomaly > 0.55 || (isActive && activeTension > 0.5)
          ? '251, 113, 133'
          : isActive
          ? '94, 234, 212'
          : '148, 163, 184';

        const maxPulseRadius =
          ((isActive ? 14 : 9) + activeEnergy * (isActive ? 14 : 7) + focusWeight * 5) *
          radiusScale;
        const peakOpacity =
          (isActive ? 0.34 + 0.46 * activeEnergy : 0.14 + 0.22 * activeEnergy) *
          focusWeight *
          bloomScale;

        for (const ringOffset of [0, 0.5]) {
          const localPhase = prefersReducedMotion
            ? 0.35 + ringOffset * 0.45
            : (phase + ringOffset + idx * 0.08) % 1;
          const easeOut = 1 - Math.pow(1 - localPhase, 2);
          const pulseR = 4 + easeOut * maxPulseRadius;
          const alpha = Math.max(0, (1 - localPhase) * peakOpacity);

          if (alpha > 0.01) {
            ctx.save();
            ctx.strokeStyle = `rgba(${baseColorRgb}, ${alpha.toFixed(3)})`;
            ctx.lineWidth = isNightMode ? 1.0 : isActive ? 1.4 : 1.0;
            ctx.beginPath();
            ctx.arc(tx, ty, pulseR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }
        }

        // Subtle inner focus reticle around the active HRTF-locked cardinal node
        if (isActive) {
          const reticleHalf = 7 + activeEnergy * 2;
          ctx.strokeStyle = `rgba(${baseColorRgb}, ${(
            (0.45 + 0.45 * activeEnergy) *
            (isNightMode ? 0.72 : 1)
          ).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.strokeRect(
            tx - reticleHalf,
            ty - reticleHalf,
            reticleHalf * 2,
            reticleHalf * 2
          );
        }

        const markerSize = isActive ? 10 : 7;
        ctx.fillStyle = isNightMode
          ? nodeAnomaly > 0.55
            ? '#FF6B4A'
            : isActive
            ? '#FF3B30'
            : '#B91C1C'
          : nodeAnomaly > 0.55
          ? '#FB7185'
          : isActive
          ? '#5EEAD4'
          : '#94A3B8';
        ctx.fillRect(tx - markerSize / 2, ty - markerSize / 2, markerSize, markerSize);

        const lx = cx + Math.cos(rad) * (maxR + 20);
        const ly = cy + Math.sin(rad) * (maxR + 18);
        ctx.fillStyle = isNightMode
          ? isActive
            ? '#FF3B30'
            : '#FF5C58'
          : isActive
          ? '#5EEAD4'
          : '#F1F5F9';
        ctx.font = isActive
          ? '700 11px "JetBrains Mono", monospace'
          : '500 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${meta.shortCardinal} ${meta.azimuthLabel}`, lx, ly);
      });

      // Center listener head marker
      ctx.fillStyle = isNightMode ? '#FF5C58' : '#F1F5F9';
      ctx.fillRect(cx - 4, cy - 4, 8, 8);

      if (!prefersReducedMotion) {
        rafId = window.requestAnimationFrame(drawFrame);
      }
    };

    redrawStaticRef.current = () => {
      if (prefersReducedMotion) {
        drawFrame(performance.now());
      }
    };

    drawFrame(performance.now());

    return () => {
      redrawStaticRef.current = null;
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  const redrawStaticRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    redrawStaticRef.current?.();
  }, [listenerAngle, activeLayerKey, vectors, windTelemetry, atmosphericFlowEnabled, nightMode]);

  const computeAngleFromPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    // 0 deg = North (up: dx=0, dy=-1)
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    deg = ((Math.round(deg) % 360) + 360) % 360;
    if (panningMode === 'cardinal') {
      deg = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
    }
    onChangeHeading(deg);
  };

  const activeLayer = NASA_GIBS_LAYERS[activeLayerKey];
  const activeVec = vectors[activeLayerKey];
  const activePulsePct = Math.round(
    Math.min(
      1,
      0.3 * (activeVec?.brightness ?? 0) +
        0.2 * (activeVec?.saturation ?? 0) +
        0.25 * (activeVec?.edgeDensity ?? 0) +
        0.25 * (activeVec?.motion ?? 0)
    ) * 100
  );
  const paddedHeading = `${String(Math.round(listenerAngle)).padStart(3, '0')}°`;

  return (
    <section
      aria-label="360-Degree Binaural Radar Compass"
      className="border border-[var(--border-grid)] bg-[var(--bg-console)] flex flex-col"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-grid)] bg-[var(--bg-panel)]">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">
          Binaural Head Compass
        </h2>
        <span className="text-xs font-mono-tabular text-[var(--accent-mint)]">
          {paddedHeading} · {activeLayer.cardinal.toUpperCase()} ·{' '}
          {windTelemetry && atmosphericFlowEnabled
            ? `FLOW ${windTelemetry.speedMs.toFixed(1)}m/s`
            : `HRTF ${activePulsePct}%`}
        </span>
      </div>

      <div className="p-3 flex flex-col sm:flex-row lg:flex-col xl:flex-row items-center gap-4">
        <div className="shrink-0 border border-[var(--border-grid)] bg-[var(--bg-obsidian)] p-1">
          <canvas
            id="radar"
            ref={canvasRef}
            width={280}
            height={280}
            onPointerDown={(e) => {
              draggingRef.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              computeAngleFromPointer(e);
            }}
            onPointerMove={(e) => {
              if (draggingRef.current) computeAngleFromPointer(e);
            }}
            onPointerUp={(e) => {
              draggingRef.current = false;
              try {
                e.currentTarget.releasePointerCapture(e.pointerId);
              } catch {
                // ignore
              }
            }}
            className="w-[220px] h-[220px] block cursor-crosshair"
            aria-label={`Interactive 360 degree binaural compass at ${paddedHeading}, nearest cardinal ${activeLayer.cardinal}`}
          />
        </div>

        <div className="flex-1 w-full flex flex-col gap-2">
          <div className="text-[11px] font-mono-tabular text-[var(--text-muted)]">
            {panningMode === 'smooth360'
              ? 'DRAG COMPASS (1°) OR PRESS ←/→ (15°) · SHIFT (5°)'
              : 'SNAP COMPASS (90°) OR PRESS ←/→ (90°) · SHIFT (15°)'}
          </div>
          {onChangePanningMode && (
            <div
              className="grid grid-cols-2 gap-1"
              role="group"
              aria-label="HRTF Spatial Panning Mode"
            >
              <button
                type="button"
                onClick={() => onChangePanningMode('smooth360')}
                aria-pressed={panningMode === 'smooth360'}
                title="Continuous 360° circular-arc HRTF spatial interpolation (P)"
                className={`py-1 px-2 text-[10px] font-mono-tabular uppercase border cursor-pointer whitespace-nowrap truncate ${
                  panningMode === 'smooth360'
                    ? 'bg-[var(--accent-mint)] border-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                    : 'bg-[var(--bg-obsidian)] border-[var(--border-grid)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                360° Smooth Pan
              </button>
              <button
                type="button"
                onClick={() => onChangePanningMode('cardinal')}
                aria-pressed={panningMode === 'cardinal'}
                title="Snap strictly to North, East, South, West cardinal layers with 500ms crossfade (P)"
                className={`py-1 px-2 text-[10px] font-mono-tabular uppercase border cursor-pointer whitespace-nowrap truncate ${
                  panningMode === 'cardinal'
                    ? 'bg-[var(--accent-mint)] border-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                    : 'bg-[var(--bg-obsidian)] border-[var(--border-grid)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                Cardinal Snap
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Cardinal Snap Buttons">
            {LAYER_ORDER.map((key) => {
              const meta = NASA_GIBS_LAYERS[key];
              const delta = Math.abs(listenerAngle - meta.azimuth);
              const shortest = Math.min(delta, 360 - delta);
              const focusWeight = 0.45 + 0.55 * Math.max(0, Math.cos((shortest * Math.PI) / 180));
              const isSelected = azimuthToLayerKey(listenerAngle) === key;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectLayer(key)}
                  aria-pressed={isSelected}
                  className={`px-2.5 py-2 text-left border font-mono-tabular text-xs cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-[var(--bg-panel)] border-[var(--accent-mint)] text-[var(--accent-mint)]'
                      : 'bg-[var(--bg-obsidian)] border-[var(--border-grid)] text-[var(--text-primary)] hover:border-[var(--accent-mint)]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">
                      [{meta.shortcutKey}] {meta.shortCardinal} {meta.azimuthLabel}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">{focusWeight.toFixed(2)}×</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-muted)] truncate">{meta.domain}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
