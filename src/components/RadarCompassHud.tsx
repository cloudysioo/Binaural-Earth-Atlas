import React, { useEffect, useRef } from 'react';
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
  onChangeHeading: (angleDeg: number) => void;
  onSelectLayer: (layerKey: LayerKey) => void;
}

export const RadarCompassHud: React.FC<RadarCompassHudProps> = ({
  listenerAngle,
  activeLayerKey,
  vectors,
  onChangeHeading,
  onSelectLayer,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = 104;

    ctx.fillStyle = '#060B14';
    ctx.fillRect(0, 0, w, h);

    // Concentric range rings
    ctx.strokeStyle = 'rgba(26, 46, 68, 0.9)';
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
      ctx.strokeStyle = deg % 90 === 0 ? '#5EEAD4' : 'rgba(148, 163, 184, 0.35)';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(rad) * inner, cy + Math.sin(rad) * inner);
      ctx.lineTo(cx + Math.cos(rad) * maxR, cy + Math.sin(rad) * maxR);
      ctx.stroke();
    }

    // Orthogonal axes
    ctx.strokeStyle = 'rgba(26, 46, 68, 0.8)';
    ctx.beginPath();
    ctx.moveTo(cx - maxR - 8, cy);
    ctx.lineTo(cx + maxR + 8, cy);
    ctx.moveTo(cx, cy - maxR - 8);
    ctx.lineTo(cx, cy + maxR + 8);
    ctx.stroke();

    // 45-degree translucent binaural listener orientation cone
    const headingRad = ((listenerAngle - 90) * Math.PI) / 180;
    const halfCone = (22.5 * Math.PI) / 180;

    ctx.save();
    ctx.fillStyle = 'rgba(94, 234, 212, 0.22)';
    ctx.strokeStyle = '#5EEAD4';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, maxR, headingRad - halfCone, headingRad + halfCone);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#5EEAD4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(headingRad) * maxR, cy + Math.sin(headingRad) * maxR);
    ctx.stroke();
    ctx.restore();

    // Cardinal targets & labels
    for (const key of LAYER_ORDER) {
      const meta = NASA_GIBS_LAYERS[key];
      const rad = ((meta.azimuth - 90) * Math.PI) / 180;
      const tx = cx + Math.cos(rad) * maxR;
      const ty = cy + Math.sin(rad) * maxR;
      const isActive = key === activeLayerKey;
      const anomaly = vectors[key]?.climateAnomaly ?? 0;

      const markerSize = isActive ? 10 : 7;
      ctx.fillStyle = anomaly > 0.55 ? '#FB7185' : isActive ? '#5EEAD4' : '#94A3B8';
      ctx.fillRect(tx - markerSize / 2, ty - markerSize / 2, markerSize, markerSize);

      const lx = cx + Math.cos(rad) * (maxR + 20);
      const ly = cy + Math.sin(rad) * (maxR + 18);
      ctx.fillStyle = isActive ? '#5EEAD4' : '#F1F5F9';
      ctx.font = isActive
        ? '700 11px "JetBrains Mono", monospace'
        : '500 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${meta.shortCardinal} ${meta.azimuthLabel}`, lx, ly);
    }

    // Center listener head marker
    ctx.fillStyle = '#F1F5F9';
    ctx.fillRect(cx - 4, cy - 4, 8, 8);
  }, [listenerAngle, activeLayerKey, vectors]);

  const computeAngleFromPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    // 0 deg = North (up: dx=0, dy=-1)
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    deg = ((Math.round(deg) % 360) + 360) % 360;
    onChangeHeading(deg);
  };

  const activeLayer = NASA_GIBS_LAYERS[activeLayerKey];
  const paddedHeading = `${String(Math.round(listenerAngle)).padStart(3, '0')}°`;

  return (
    <section
      aria-label="360-Degree Binaural Radar Compass"
      className="border border-[#1A2E44] bg-[#0B1320] flex flex-col"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1A2E44] bg-[#111D30]">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#F1F5F9]">
          Binaural Head Compass
        </h2>
        <span className="text-xs font-mono-tabular text-[#5EEAD4]">
          {paddedHeading} · {activeLayer.cardinal.toUpperCase()}
        </span>
      </div>

      <div className="p-3 flex flex-col sm:flex-row lg:flex-col xl:flex-row items-center gap-4">
        <div className="shrink-0 border border-[#1A2E44] bg-[#060B14] p-1">
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
          <div className="text-[11px] font-mono-tabular text-[#94A3B8]">
            DRAG COMPASS OR PRESS ←/→ (90°) · SHIFT+←/→ (15°)
          </div>
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
                      ? 'bg-[#111D30] border-[#5EEAD4] text-[#5EEAD4]'
                      : 'bg-[#060B14] border-[#1A2E44] text-[#F1F5F9] hover:border-[#5EEAD4]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">
                      [{meta.shortcutKey}] {meta.shortCardinal} {meta.azimuthLabel}
                    </span>
                    <span className="text-[10px] text-[#94A3B8]">{focusWeight.toFixed(2)}×</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#94A3B8] truncate">{meta.domain}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
