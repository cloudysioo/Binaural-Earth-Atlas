import React, { useEffect, useRef } from 'react';
import { Magnet, RotateCw, Zap } from 'lucide-react';
import { HeadingWindTelemetry } from '../analysis/windVectorField';
import { SpatialPanningMode } from '../audio/audioEngine';
import { BeaThemePalette, resolveTheme } from '../theme/themes';
import {
  azimuthToLayerKey,
  FeatureVector,
  LAYER_ORDER,
  LayerKey,
  NASA_GIBS_LAYERS,
} from '../types/bea';
import { TactileSwitchToggle } from './TactileSwitchToggle';

export interface AuroralPulseSignal {
  seq: number;
  triggeredAtMs: number;
  intensity: number;
  chimeHz: number;
  targetHeadingDeg?: number;
}

export interface SolarFlareSignal {
  seq: number;
  triggeredAtMs: number;
  solarWindKms: number;
  sweepStartHz: number;
}

const AURORAL_PULSE_DURATION_SEC = 1.15;
const SOLAR_FLARE_DURATION_SEC = 0.72;
// Synchronized with SolarChimeSynth's 5-grain metallic chime schedule
const AURORAL_CHIME_GRAINS = [
  { delay: 0.0, dur: 0.36, weight: 1.0, radiusScale: 0.72 },
  { delay: 0.055, dur: 0.12, weight: 0.85, radiusScale: 0.48 },
  { delay: 0.115, dur: 0.11, weight: 0.8, radiusScale: 0.56 },
  { delay: 0.185, dur: 0.52, weight: 1.05, radiusScale: 0.92 },
  { delay: 0.31, dur: 0.22, weight: 0.78, radiusScale: 1.0 },
];

function findPeakAnomalyTarget(
  vectors: Record<LayerKey, FeatureVector>,
  fallbackActiveKey: LayerKey
): { peakKey: LayerKey; peakAzimuth: number; peakAnomaly: number } {
  let bestKey: LayerKey = fallbackActiveKey;
  let bestAnomaly = -1;
  let bestTieScore = -1;

  for (const key of LAYER_ORDER) {
    const vec = vectors[key];
    const anomaly = vec?.climateAnomaly ?? 0;
    const tieScore =
      anomaly +
      0.01 * ((vec?.edgeDensity ?? 0) + (vec?.motion ?? 0)) +
      (key === fallbackActiveKey ? 0.002 : 0);
    if (anomaly > bestAnomaly + 0.001 || (Math.abs(anomaly - bestAnomaly) <= 0.001 && tieScore > bestTieScore)) {
      bestKey = key;
      bestAnomaly = anomaly;
      bestTieScore = tieScore;
    }
  }

  return {
    peakKey: bestKey,
    peakAzimuth: NASA_GIBS_LAYERS[bestKey].azimuth,
    peakAnomaly: Math.max(0, bestAnomaly),
  };
}

interface RadarCompassHudProps {
  listenerAngle: number;
  activeLayerKey: LayerKey;
  vectors: Record<LayerKey, FeatureVector>;
  panningMode?: SpatialPanningMode;
  autoRotate?: boolean;
  magneticSnap?: boolean;
  windTelemetry?: HeadingWindTelemetry | null;
  atmosphericFlowEnabled?: boolean;
  nightMode?: boolean;
  theme?: BeaThemePalette;
  auroralPulse?: AuroralPulseSignal | null;
  solarFlare?: SolarFlareSignal | null;
  onChangeHeading: (angleDeg: number) => void;
  onSelectLayer: (layerKey: LayerKey) => void;
  onChangePanningMode?: (mode: SpatialPanningMode) => void;
  onToggleAutoRotate?: () => void;
  onToggleMagneticSnap?: () => void;
}

export const RadarCompassHud: React.FC<RadarCompassHudProps> = ({
  listenerAngle,
  activeLayerKey,
  vectors,
  panningMode = 'smooth360',
  autoRotate = false,
  magneticSnap = false,
  windTelemetry = null,
  atmosphericFlowEnabled = true,
  nightMode = false,
  theme,
  auroralPulse = null,
  solarFlare = null,
  onChangeHeading,
  onSelectLayer,
  onChangePanningMode,
  onToggleAutoRotate,
  onToggleMagneticSnap,
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
    theme,
    magneticSnap,
    auroralPulse,
    solarFlare,
  });
  latestPropsRef.current = {
    listenerAngle,
    activeLayerKey,
    vectors,
    windTelemetry,
    atmosphericFlowEnabled,
    nightMode,
    theme,
    magneticSnap,
    auroralPulse,
    solarFlare,
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
        theme: currentTheme,
        magneticSnap: isMagneticSnap,
        auroralPulse: activeAuroralPulse,
        solarFlare: activeSolarFlare,
      } = latestPropsRef.current;

      const pal = resolveTheme(currentTheme, isNightMode);
      const c = pal.canvas;
      const isNight = pal.isNightFilter;

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

      ctx.fillStyle = c.bg;
      ctx.fillRect(0, 0, w, h);

      // Concentric range rings
      ctx.strokeStyle = c.gridLine;
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
            ? c.primary
            : isNight
            ? 'rgba(185, 28, 28, 0.38)'
            : `rgba(${c.primaryRgb}, 0.32)`;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(rad) * inner, cy + Math.sin(rad) * inner);
        ctx.lineTo(cx + Math.cos(rad) * maxR, cy + Math.sin(rad) * maxR);
        ctx.stroke();
      }

      // Orthogonal axes
      ctx.strokeStyle = c.axisLine;
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
      ctx.fillStyle = `rgba(${c.primaryRgb}, ${isNight ? 0.14 : 0.22})`;
      ctx.strokeStyle = c.primary;
      ctx.lineWidth = isNight ? 1.25 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, maxR, headingRad - halfCone, headingRad + halfCone);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = c.primary;
      ctx.lineWidth = isNight ? 1.5 : 2;
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
          ? `rgba(${c.tertiaryRgb}, ${isNight ? 0.72 : 0.85})`
          : `rgba(${c.skyRgb}, ${isNight ? 0.45 : 0.65})`;
        ctx.lineWidth = isNight ? 1.6 : 2.2;
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
      const bloomScale = isNight ? 0.5 : 1.0;
      const radiusScale = isNight ? 0.72 : 1.0;

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
        const baseColorRgb =
          nodeAnomaly > 0.55 || (isActive && activeTension > 0.5)
            ? c.secondaryRgb
            : isActive
            ? c.primaryRgb
            : isNight
            ? '185, 28, 28'
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
            ctx.lineWidth = isNight ? 1.0 : isActive ? 1.4 : 1.0;
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
            (isNight ? 0.72 : 1)
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
        ctx.fillStyle =
          nodeAnomaly > 0.55
            ? c.secondary
            : isActive
            ? c.primary
            : isNight
            ? c.borderStrong
            : '#94A3B8';
        ctx.fillRect(tx - markerSize / 2, ty - markerSize / 2, markerSize, markerSize);

        if (isMagneticSnap && nodeAnomaly >= 0.36) {
          ctx.save();
          ctx.strokeStyle = c.secondary;
          ctx.lineWidth = 1.35;
          ctx.strokeRect(tx - 10, ty - 10, 20, 20);
          ctx.restore();
        }

        const lx = cx + Math.cos(rad) * (maxR + 20);
        const ly = cy + Math.sin(rad) * (maxR + 18);
        ctx.fillStyle = isActive ? c.primary : c.textPrimary;
        ctx.font = isActive
          ? '700 11px "JetBrains Mono", monospace'
          : '500 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${meta.shortCardinal} ${meta.azimuthLabel}`, lx, ly);
      });

      // Chime-synced 'Auroral Pulse' glowing ring at the highest-intensity anomaly heading
      const peakTarget = findPeakAnomalyTarget(currentVectors, activeKey);
      const peakHeadingDeg =
        activeAuroralPulse?.targetHeadingDeg ?? peakTarget.peakAzimuth;
      const peakRad = ((peakHeadingDeg - 90) * Math.PI) / 180;
      const px = cx + Math.cos(peakRad) * maxR;
      const py = cy + Math.sin(peakRad) * maxR;

      const elapsedAuroralSec = activeAuroralPulse
        ? (now - activeAuroralPulse.triggeredAtMs) / 1000
        : -1;
      const isAuroralBurstActive =
        activeAuroralPulse !== null &&
        elapsedAuroralSec >= 0 &&
        elapsedAuroralSec <= AURORAL_PULSE_DURATION_SEC;

      // Ambient steady low-glow ring marking peak anomaly heading when intensity is elevated
      if (!isAuroralBurstActive && peakTarget.peakAnomaly >= 0.36) {
        const idleBreath = prefersReducedMotion ? 0.55 : 0.45 + 0.55 * Math.sin(phase * Math.PI * 2);
        const ambientAlpha = (0.14 + 0.14 * idleBreath) * (isNight ? 0.65 : 1);
        ctx.save();
        ctx.strokeStyle = `rgba(${c.auroraPrimaryRgb}, ${ambientAlpha.toFixed(3)})`;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.arc(px, py, 13 + idleBreath * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (isAuroralBurstActive && activeAuroralPulse) {
        const pulseNorm = prefersReducedMotion
          ? 0.42
          : Math.min(1, elapsedAuroralSec / AURORAL_PULSE_DURATION_SEC);
        const burstIntensity = Math.max(0.45, Math.min(1, activeAuroralPulse.intensity));
        const nightBloom = isNight ? 0.58 : 1.0;

        // Quantized sample-and-hold shimmer step synced to SolarChimeSynth's digital stutter
        const glitchTick = Math.floor(elapsedAuroralSec * 44);
        const glitchJitter =
          prefersReducedMotion || glitchTick % 5 === 2
            ? 0
            : ((glitchTick * 37) % 7) - 3;

        // 1. Subtle radial azimuth ray connecting center listener to the peak-anomaly aurora ring
        const rayAlpha = (1 - pulseNorm) * 0.42 * burstIntensity * nightBloom;
        ctx.save();
        ctx.strokeStyle = `rgba(${c.auroraPrimaryRgb}, ${rayAlpha.toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.restore();

        // 2. Soft luminous auroral radial corona halo centered at the peak-anomaly heading
        const coronaRadius = Math.min(34, 18 + (1 - Math.pow(1 - pulseNorm, 2)) * 16);
        const coronaAlpha = (1 - Math.pow(pulseNorm, 1.3)) * 0.55 * burstIntensity * nightBloom;
        ctx.save();
        const auraGrad = ctx.createRadialGradient(px, py, 2, px, py, coronaRadius);
        auraGrad.addColorStop(0, c.auroraCorona[0]);
        auraGrad.addColorStop(0.5, c.auroraCorona[1]);
        auraGrad.addColorStop(0.85, c.auroraCorona[2]);
        auraGrad.addColorStop(1, `rgba(${c.auroraPrimaryRgb}, 0)`);
        ctx.globalAlpha = Math.min(1, Math.max(0, coronaAlpha * 1.4));
        ctx.fillStyle = auraGrad;
        ctx.beginPath();
        ctx.arc(px, py, coronaRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 3. Five concentric glowing wavefront rings locked to SolarChimeSynth's 5 FM grain delays
        AURORAL_CHIME_GRAINS.forEach((grain, grainIdx) => {
          const grainElapsed = prefersReducedMotion ? 0.14 : elapsedAuroralSec - grain.delay;
          if (grainElapsed < 0 || grainElapsed > grain.dur + 0.42) return;

          const totalGrainSpan = grain.dur + 0.42;
          const gNorm = Math.min(1, grainElapsed / totalGrainSpan);
          const easeOut = 1 - Math.pow(1 - gNorm, 2.2);
          const ringRadius =
            (7 + easeOut * (22 * grain.radiusScale + burstIntensity * 4) + glitchJitter * 0.45) *
            (isNight ? 0.85 : 1);
          const ringAlpha =
            Math.max(0, (1 - gNorm) * 0.92 * grain.weight * burstIntensity) * nightBloom;

          if (ringAlpha <= 0.02) return;

          const isGlitchGrain = grainIdx === 1 || grainIdx === 2 || grainIdx === 4;
          const strokeRgb = isGlitchGrain ? c.auroraGlitchRgb : c.auroraPrimaryRgb;

          ctx.save();
          ctx.shadowColor = `rgba(${strokeRgb}, 0.92)`;
          ctx.shadowBlur = isNight ? 7 : 14;
          ctx.strokeStyle = `rgba(${strokeRgb}, ${Math.min(1, ringAlpha).toFixed(3)})`;
          ctx.lineWidth = isGlitchGrain ? 1.6 : 2.3;
          if (isGlitchGrain) {
            ctx.setLineDash([5, 3, 2, 3]);
          }
          ctx.beginPath();
          ctx.arc(px, py, Math.max(4, ringRadius), 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        });

        // 4. Perimeter auroral arc flare spanning the peak-anomaly sector azimuth
        const sectorSpan = 0.24 + (1 - pulseNorm) * 0.16;
        const arcAlpha = (1 - pulseNorm) * 0.88 * burstIntensity * nightBloom;
        ctx.save();
        ctx.shadowColor = `rgb(${c.auroraPrimaryRgb})`;
        ctx.shadowBlur = isNight ? 6 : 12;
        ctx.strokeStyle = `rgba(${c.auroraPrimaryRgb}, ${arcAlpha.toFixed(3)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, maxR, peakRad - sectorSpan, peakRad + sectorSpan);
        ctx.stroke();
        ctx.restore();
      }

      // Solar Flare white-noise shock & downward frequency-sweep visual indicator (distinct from circular Auroral Pulse)
      const elapsedFlareSec = activeSolarFlare
        ? (now - activeSolarFlare.triggeredAtMs) / 1000
        : -1;
      const isSolarFlareBurstActive =
        activeSolarFlare !== null &&
        elapsedFlareSec >= 0 &&
        elapsedFlareSec <= SOLAR_FLARE_DURATION_SEC;

      if (isSolarFlareBurstActive && activeSolarFlare) {
        const flareNorm = prefersReducedMotion
          ? 0.25
          : Math.min(1, elapsedFlareSec / SOLAR_FLARE_DURATION_SEC);
        const flareEnergy = Math.max(
          0.65,
          Math.min(1.25, (activeSolarFlare.solarWindKms - 550) / 320 + 0.65)
        );
        const nightScale = isNight ? 0.68 : 1.0;

        // 1. Crisp angular square shock-frame perimeter flash & 90-degree corner brackets
        const frameAlpha = Math.max(0, 1 - flareNorm * 1.15) * 0.92 * nightScale;
        if (frameAlpha > 0.02) {
          ctx.save();
          ctx.strokeStyle = `rgba(${c.flarePrimaryRgb}, ${(frameAlpha * 0.7).toFixed(3)})`;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(4, 4, w - 8, h - 8);

          const bracketLen = 16;
          ctx.strokeStyle = `rgba(${c.flareBrightRgb}, ${frameAlpha.toFixed(3)})`;
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          // Top-left
          ctx.moveTo(6, 6 + bracketLen);
          ctx.lineTo(6, 6);
          ctx.lineTo(6 + bracketLen, 6);
          // Top-right
          ctx.moveTo(w - 6 - bracketLen, 6);
          ctx.lineTo(w - 6, 6);
          ctx.lineTo(w - 6, 6 + bracketLen);
          // Bottom-right
          ctx.moveTo(w - 6, h - 6 - bracketLen);
          ctx.lineTo(w - 6, h - 6);
          ctx.lineTo(w - 6 - bracketLen, h - 6);
          // Bottom-left
          ctx.moveTo(6 + bracketLen, h - 6);
          ctx.lineTo(6, h - 6);
          ctx.lineTo(6, h - 6 - bracketLen);
          ctx.stroke();
          ctx.restore();
        }

        // 2. Full-360° high-frequency broadband white-noise static spikes around outer compass perimeter
        const staticFade = prefersReducedMotion
          ? 0.65
          : Math.max(0, 1 - elapsedFlareSec / 0.58);
        if (staticFade > 0.02) {
          const noiseTick = prefersReducedMotion ? 11 : Math.floor(elapsedFlareSec * 60);
          const spikeCount = 36;
          ctx.save();
          for (let i = 0; i < spikeCount; i++) {
            const rad = (i / spikeCount) * Math.PI * 2;
            const hash = ((i * 73 + noiseTick * 139) % 100) / 100;
            if (!prefersReducedMotion && hash < 0.24) continue;
            const spikeReach = (4 + hash * 12) * flareEnergy;
            const innerR = maxR - (3 + hash * 6);
            const outerR = maxR + spikeReach;
            const spikeAlpha = staticFade * (0.45 + 0.55 * hash) * nightScale;
            ctx.strokeStyle =
              hash > 0.72 && !isNight
                ? `rgba(${c.flareBrightRgb}, ${Math.min(1, spikeAlpha).toFixed(3)})`
                : `rgba(${c.flarePrimaryRgb}, ${Math.min(1, spikeAlpha).toFixed(3)})`;
            ctx.lineWidth = hash > 0.78 ? 2.1 : 1.25;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(rad) * innerR, cy + Math.sin(rad) * innerR);
            ctx.lineTo(cx + Math.cos(rad) * outerR, cy + Math.sin(rad) * outerR);
            ctx.stroke();
          }
          ctx.restore();
        }

        // 3. Sharp inward frequency-sweep implosion rings mirroring the ~9kHz -> 260Hz bandpass sweep
        const sweepWindows = [
          { delay: 0.0, dur: 0.44, weight: 1.0, dashed: false },
          { delay: 0.07, dur: 0.41, weight: 0.68, dashed: true },
        ];
        sweepWindows.forEach((sweep, idx) => {
          const sElapsed = prefersReducedMotion ? 0.14 + idx * 0.06 : elapsedFlareSec - sweep.delay;
          if (sElapsed < 0 || sElapsed > sweep.dur) return;

          const sNorm = Math.min(1, sElapsed / sweep.dur);
          const sweepRadius = 6 + (maxR + 14 - 6) * Math.pow(1 - sNorm, 1.85);
          const sAlpha = Math.max(0, (1 - Math.pow(sNorm, 1.4)) * 0.96 * sweep.weight) * nightScale;

          ctx.save();
          ctx.shadowColor = `rgb(${c.flarePrimaryRgb})`;
          ctx.shadowBlur = isNight ? 8 : 14;
          ctx.strokeStyle =
            idx === 0 && !isNight
              ? `rgba(${c.flareBrightRgb}, ${Math.min(1, sAlpha).toFixed(3)})`
              : `rgba(${c.flarePrimaryRgb}, ${Math.min(1, sAlpha).toFixed(3)})`;
          ctx.lineWidth = idx === 0 ? 2.5 : 1.5;
          if (sweep.dashed) {
            ctx.setLineDash([7, 4]);
          }
          ctx.beginPath();
          ctx.arc(cx, cy, sweepRadius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        });

        // 4. Center shock crosshair reticle ticks
        const crossAlpha = Math.max(0, 1 - flareNorm * 1.4) * 0.95 * nightScale;
        if (crossAlpha > 0.02) {
          ctx.save();
          ctx.strokeStyle = `rgba(${c.flareBrightRgb}, ${crossAlpha.toFixed(3)})`;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(cx - 22, cy);
          ctx.lineTo(cx - 10, cy);
          ctx.moveTo(cx + 10, cy);
          ctx.lineTo(cx + 22, cy);
          ctx.moveTo(cx, cy - 22);
          ctx.lineTo(cx, cy - 10);
          ctx.moveTo(cx, cy + 10);
          ctx.lineTo(cx, cy + 22);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Center listener head marker
      ctx.fillStyle = isSolarFlareBurstActive
        ? `rgb(${c.flareBrightRgb})`
        : c.textPrimary;
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
  }, [
    listenerAngle,
    activeLayerKey,
    vectors,
    windTelemetry,
    atmosphericFlowEnabled,
    nightMode,
    theme,
    magneticSnap,
    auroralPulse,
    solarFlare,
  ]);

  useEffect(() => {
    if (!auroralPulse) return;
    const timer = window.setTimeout(() => {
      redrawStaticRef.current?.();
    }, Math.round(AURORAL_PULSE_DURATION_SEC * 1000) + 40);
    return () => window.clearTimeout(timer);
  }, [auroralPulse]);

  useEffect(() => {
    if (!solarFlare) return;
    const timer = window.setTimeout(() => {
      redrawStaticRef.current?.();
    }, Math.round(SOLAR_FLARE_DURATION_SEC * 1000) + 40);
    return () => window.clearTimeout(timer);
  }, [solarFlare]);

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
  const peakAnomalyTarget = findPeakAnomalyTarget(vectors, activeLayerKey);
  const peakAnomalyMeta = NASA_GIBS_LAYERS[peakAnomalyTarget.peakKey];
  const isAuroralPulseFresh =
    auroralPulse !== null &&
    performance.now() - auroralPulse.triggeredAtMs <= AURORAL_PULSE_DURATION_SEC * 1000;
  const isSolarFlareFresh =
    solarFlare !== null &&
    performance.now() - solarFlare.triggeredAtMs <= SOLAR_FLARE_DURATION_SEC * 1000;
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
  const displayHeadingDeg = ((Math.round(listenerAngle) % 360) + 360) % 360;
  const paddedHeading = `${String(displayHeadingDeg).padStart(3, '0')}°`;

  return (
    <section
      aria-label="360-Degree Binaural Radar Compass"
      className={`border bg-[var(--bg-console)] flex flex-col ${
        isSolarFlareFresh ? 'border-[var(--accent-coral)]' : 'border-[var(--border-strong)]'
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border-grid)] bg-[var(--bg-panel)]">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] truncate min-w-0">
          Binaural Head Compass
        </h2>
        <span
          className={`text-[11px] sm:text-xs font-mono-tabular whitespace-nowrap shrink-0 ${
            isSolarFlareFresh
              ? 'text-[var(--accent-coral)] font-semibold'
              : isAuroralPulseFresh
              ? 'text-[var(--accent-amber)] font-semibold'
              : 'text-[var(--accent-mint)]'
          }`}
        >
          {paddedHeading} · {activeLayer.cardinal.toUpperCase()} ·{' '}
          {isSolarFlareFresh && solarFlare
            ? `FLARE SHOCK ${solarFlare.solarWindKms}KM/S`
            : isAuroralPulseFresh
            ? `AURORA PULSE ${peakAnomalyMeta.shortCardinal} ${peakAnomalyMeta.azimuthLabel}`
            : magneticSnap
            ? 'MAG LOCK'
            : autoRotate
            ? 'AUTO 5°/s'
            : windTelemetry && atmosphericFlowEnabled
            ? `FLOW ${windTelemetry.speedMs.toFixed(1)}m/s`
            : `HRTF ${activePulsePct}%`}
        </span>
      </div>

      <div className="p-3 flex flex-col sm:flex-row items-center sm:items-stretch gap-3.5">
        <div className="shrink-0 border border-[var(--border-strong)] bg-[var(--bg-obsidian)] p-1 flex items-center justify-center self-center">
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
            className="w-[196px] h-[196px] xl:w-[210px] xl:h-[210px] block cursor-crosshair touch-none select-none"
            aria-label={`Interactive 360 degree binaural compass at ${paddedHeading}, nearest cardinal ${activeLayer.cardinal}`}
          />
        </div>

        <div className="flex-1 w-full min-w-0 flex flex-col justify-between gap-2.5">
          {isSolarFlareFresh && solarFlare && (
            <div
              role="status"
              aria-live="polite"
              className="px-2.5 py-1.5 border border-[var(--accent-coral)] bg-[var(--bg-panel)] text-[var(--accent-coral)] text-[11px] font-mono-tabular uppercase tracking-wide flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-1.5 font-semibold min-w-0 truncate">
                <Zap className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">FLARE · {solarFlare.solarWindKms} KM/S</span>
              </span>
              <span className="shrink-0 font-semibold">
                {(solarFlare.sweepStartHz / 1000).toFixed(1)}K→260HZ
              </span>
            </div>
          )}

          <div className="border border-[var(--border-grid)] bg-[var(--bg-obsidian)] px-2.5 py-1.5 text-[11px] font-mono-tabular text-[var(--text-muted)] leading-snug">
            {magneticSnap
              ? 'MAG SNAP: Locked to peak anomaly centers (G)'
              : autoRotate
              ? 'AUTO 5°/s: Drag compass or ←/→ to steer'
              : panningMode === 'smooth360'
              ? 'DRAG (1°) · KEYS ←/→ (15°) · SHIFT (5°)'
              : 'SNAP (90°) · KEYS ←/→ (90°) · SHIFT (15°)'}
          </div>

          {(onChangePanningMode || onToggleAutoRotate || onToggleMagneticSnap) && (
            <div
              className="flex flex-col gap-2"
              role="group"
              aria-label="HRTF Spatial Panning Mode, Auto-Rotate, and Magnetic Snap"
            >
              {onChangePanningMode && (
                <div className="grid grid-cols-2 border border-[var(--border-strong)] bg-[var(--bg-obsidian)]">
                  <button
                    type="button"
                    onClick={() => onChangePanningMode('smooth360')}
                    aria-pressed={panningMode === 'smooth360'}
                    title="Continuous 360° circular-arc HRTF spatial interpolation (P)"
                    className={`py-2 sm:py-1.5 px-2 text-[11px] font-mono-tabular uppercase border-r border-[var(--border-grid)] cursor-pointer whitespace-nowrap truncate ${
                      panningMode === 'smooth360'
                        ? 'bg-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                        : 'bg-[var(--bg-control)] text-[var(--text-primary)] hover:text-[var(--accent-mint)]'
                    }`}
                  >
                    360° Pan
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangePanningMode('cardinal')}
                    aria-pressed={panningMode === 'cardinal'}
                    title="Snap strictly to North, East, South, West cardinal layers with 500ms crossfade (P)"
                    className={`py-2 sm:py-1.5 px-2 text-[11px] font-mono-tabular uppercase cursor-pointer whitespace-nowrap truncate ${
                      panningMode === 'cardinal'
                        ? 'bg-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                        : 'bg-[var(--bg-control)] text-[var(--text-primary)] hover:text-[var(--accent-mint)]'
                    }`}
                  >
                    Cardinal Snap
                  </button>
                </div>
              )}

              {(onToggleAutoRotate || onToggleMagneticSnap) && (
                <div className="flex flex-col gap-1.5">
                  {onToggleAutoRotate && (
                    <TactileSwitchToggle
                      checked={autoRotate}
                      onToggle={onToggleAutoRotate}
                      label="Auto-Rotate"
                      shortcut="O"
                      accent="amber"
                      compact
                      className="w-full"
                      icon={
                        <RotateCw
                          className={`w-3.5 h-3.5 ${
                            autoRotate ? 'animate-[spin_6s_linear_infinite]' : ''
                          }`}
                        />
                      }
                      title="Automatically rotate binaural audio heading at 5°/s for passive 360° soundfield scanning (Shortcut: O)"
                    />
                  )}
                  {onToggleMagneticSnap && (
                    <TactileSwitchToggle
                      checked={magneticSnap}
                      onToggle={onToggleMagneticSnap}
                      label="Magnetic Snap"
                      shortcut="G"
                      accent="coral"
                      compact
                      className="w-full"
                      icon={<Magnet className="w-3.5 h-3.5" />}
                      title="Magnetic Snap: Align heading to nearest high-intensity climate anomaly center with haptic audio feedback (Shortcut: G)"
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Full-width 2x2 Cardinal Sector Strip for spacious zero-truncation desktop control */}
      <div
        className="px-3 pb-3 pt-2.5 border-t border-[var(--border-grid)] bg-[var(--bg-obsidian)]/40 grid grid-cols-2 gap-2"
        role="group"
        aria-label="Cardinal Snap Buttons"
      >
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
              className={`px-2.5 py-2.5 sm:py-2 text-left border font-mono-tabular text-xs cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-[var(--bg-panel)] border-[var(--accent-mint)] text-[var(--accent-mint)]'
                  : 'bg-[var(--bg-control)] border-[var(--border-strong)] text-[var(--text-primary)] hover:border-[var(--accent-mint)]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold whitespace-nowrap">
                  [{meta.shortcutKey}] {meta.shortCardinal} {meta.azimuthLabel}
                </span>
                <span
                  className={`text-[11px] shrink-0 ${
                    isSelected ? 'text-[var(--accent-mint)] font-semibold' : 'text-[var(--text-muted)]'
                  }`}
                >
                  {focusWeight.toFixed(2)}×
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--text-muted)] truncate">{meta.domain}</div>
            </button>
          );
        })}
      </div>
    </section>
  );
};
