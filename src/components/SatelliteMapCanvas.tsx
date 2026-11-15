import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Globe, Map as MapIcon, Sun, Thermometer } from 'lucide-react';
import {
  ANOMALY_MAX_C,
  ANOMALY_MIN_C,
  buildClimateAnomalyField,
  getAnomalyLegendStops,
  renderD3HeatmapContoursOrthographic,
  renderD3HeatmapOverlayPlate,
  sampleDeltaAt,
} from '../analysis/climateAnomalyHeatmap';
import { ANALYSIS_HEIGHT, ANALYSIS_WIDTH } from '../analysis/pixelScanner';
import { sampleWindAtCoord, WindVectorField } from '../analysis/windVectorField';
import {
  computeSolarPosition,
  formatCoordLat,
  formatCoordLon,
  renderSolarTerminatorOrthographic,
  renderSolarTerminatorPlate,
  sampleSolarAt,
  shadePixelBySolarCosZ,
  SolarRegime,
} from '../geo/solarTerminator';
import {
  COASTLINE_LINES_RAD,
  COUNTRY_BORDERS_RAD,
  strokePackedLinesOrthographic,
  strokePackedLinesPlate,
} from '../geo/worldBorders';
import { ArchiveYear, LayerKey, NASA_GIBS_LAYERS } from '../types/bea';

export type ProjectionMode = 'globe' | 'plate';

interface ClimateBookmark {
  id: string;
  label: string;
  lat: number;
  lon: number;
  layerKey: LayerKey;
}

const CLIMATE_BOOKMARKS: ClimateBookmark[] = [
  { id: 'beaufort', label: 'Beaufort Sea 74°N', lat: 74, lon: -145, layerKey: 'north' },
  { id: 'nino34', label: 'Niño 3.4 Pacific 0°', lat: 0, lon: -140, layerKey: 'south' },
  { id: 'gulfstream', label: 'Gulf Stream 38°N', lat: 38, lon: -65, layerKey: 'east' },
  { id: 'amazon', label: 'Amazon Basin 3°S', lat: -3, lon: -60, layerKey: 'west' },
];

interface SatelliteMapCanvasProps {
  sourceCanvas: HTMLCanvasElement | null;
  sstCanvas: HTMLCanvasElement | null;
  activeLayerKey: LayerKey;
  archiveYear: ArchiveYear;
  dateString: string;
  frameRevision: number;
  dataSource: string;
  isLoading: boolean;
  projection: ProjectionMode;
  showAnomalyHeatmap: boolean;
  showSolarTerminator: boolean;
  utcTimestampMs: number;
  windField?: WindVectorField | null;
  nightMode?: boolean;
  onToggleProjection: (mode: ProjectionMode) => void;
  onToggleAnomalyHeatmap: () => void;
  onToggleSolarTerminator: () => void;
  onSelectBookmark: (layerKey: LayerKey, label: string) => void;
}

interface FittedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Computes the largest rectangle inside (containerW, containerH) that preserves the
 * source aspect ratio (e.g. 2:1 for Plate Carrée EPSG:4326) without any clipping.
 */
function computeContainedRect(
  containerW: number,
  containerH: number,
  sourceW: number,
  sourceH: number
): FittedRect {
  const safeCW = Math.max(1, containerW);
  const safeCH = Math.max(1, containerH);
  const sourceAspect = sourceW / Math.max(1, sourceH);
  const containerAspect = safeCW / safeCH;

  let drawW = safeCW;
  let drawH = safeCH;

  if (containerAspect > sourceAspect) {
    drawH = safeCH;
    drawW = safeCH * sourceAspect;
  } else {
    drawW = safeCW;
    drawH = safeCW / sourceAspect;
  }

  return {
    x: (safeCW - drawW) / 2,
    y: (safeCH - drawH) / 2,
    w: drawW,
    h: drawH,
  };
}

/**
 * Projects a geographic coordinate (lat, lon in radians) onto an orthographic 3D sphere.
 * Returns null when the point lies on the far hemisphere (cosC < 0).
 */
function projectOrthographic(
  latRad: number,
  lonRad: number,
  phi0: number,
  lam0: number,
  cx: number,
  cy: number,
  R: number
): [number, number] | null {
  const sinPhi0 = Math.sin(phi0);
  const cosPhi0 = Math.cos(phi0);
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const dLon = lonRad - lam0;
  const cosC = sinPhi0 * sinLat + cosPhi0 * cosLat * Math.cos(dLon);
  if (cosC < 0) return null;

  const x = cx + R * cosLat * Math.sin(dLon);
  const y = cy - R * (cosPhi0 * sinLat - sinPhi0 * cosLat * Math.cos(dLon));
  return [x, y];
}

export const SatelliteMapCanvas: React.FC<SatelliteMapCanvasProps> = ({
  sourceCanvas,
  sstCanvas,
  activeLayerKey,
  archiveYear,
  dateString,
  frameRevision,
  dataSource,
  isLoading,
  projection,
  showAnomalyHeatmap,
  showSolarTerminator,
  utcTimestampMs,
  windField = null,
  nightMode = false,
  onToggleProjection,
  onToggleAnomalyHeatmap,
  onToggleSolarTerminator,
  onSelectBookmark,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const globeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fittedRectRef = useRef<FittedRect>({ x: 0, y: 0, w: ANALYSIS_WIDTH, h: ANALYSIS_HEIGHT });

  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 840,
    height: 420,
  });

  const [probeInfo, setProbeInfo] = useState<{
    lat: string;
    lon: string;
    lumPct: number;
    anomalyPct: number;
    deltaC: number;
    solarElevDeg: number;
    solarRegime: SolarRegime;
    windSpeedMs: number | null;
    windBearingDeg: number | null;
    windOcean: boolean;
    cursorX: number;
    cursorY: number;
    isDragging: boolean;
  } | null>(null);

  const legendStops = useMemo(() => getAnomalyLegendStops(), []);

  const solarPosition = useMemo(() => computeSolarPosition(utcTimestampMs), [utcTimestampMs]);

  const anomalyField = useMemo(() => {
    if (!sstCanvas && !sourceCanvas) return null;
    return buildClimateAnomalyField(sstCanvas, sourceCanvas, dateString, archiveYear);
  }, [sstCanvas, sourceCanvas, dateString, archiveYear, frameRevision]);

  const sourcePixels = useMemo(() => {
    if (!sourceCanvas) return null;
    const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    return ctx.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT).data;
  }, [sourceCanvas, frameRevision]);

  const layerLumStats = useMemo(() => {
    if (!sourcePixels) return { mean: 40, sigma: 25 };
    const step = 8;
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let y = 0; y < ANALYSIS_HEIGHT; y += step) {
      for (let x = 0; x < ANALYSIS_WIDTH; x += step) {
        const idx = (y * ANALYSIS_WIDTH + x) * 4;
        const lum = 0.299 * sourcePixels[idx] + 0.587 * sourcePixels[idx + 1] + 0.114 * sourcePixels[idx + 2];
        sum += lum;
        sumSq += lum * lum;
        count++;
      }
    }
    const mean = count > 0 ? sum / count : 40;
    const variance = count > 0 ? Math.max(0, sumSq / count - mean * mean) : 625;
    return { mean, sigma: Math.sqrt(variance) };
  }, [sourcePixels]);

  const [globeCenter, setGlobeCenter] = useState<{ lat: number; lon: number }>({
    lat: 45,
    lon: -45,
  });
  const dragRef = useRef<{ active: boolean; x: number; y: number }>({
    active: false,
    x: 0,
    y: 0,
  });

  useEffect(() => {
    setProbeInfo(null);
  }, [projection]);

  // Dynamically observe container dimensions for zero-clipping aspect-aware scaling
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const nextW = Math.max(280, Math.round(rect.width));
      const nextH = Math.max(200, Math.round(rect.height));
      setContainerSize((prev) =>
        prev.width === nextW && prev.height === nextH ? prev : { width: nextW, height: nextH }
      );
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Smoothly tilt globe view toward the active phenomenon's primary latitude band when layer changes
  useEffect(() => {
    if (activeLayerKey === 'north') {
      setGlobeCenter((prev) => ({ ...prev, lat: 68 }));
    } else if (activeLayerKey === 'south') {
      setGlobeCenter((prev) => ({ ...prev, lat: 6 }));
    } else if (activeLayerKey === 'east') {
      setGlobeCenter((prev) => ({ ...prev, lat: 28 }));
    } else {
      setGlobeCenter((prev) => ({ ...prev, lat: 14 }));
    }
  }, [activeLayerKey]);

  // Render dynamically scaled Plate Carrée (EPSG:4326) map fitted to container aspect without clipping
  useEffect(() => {
    if (projection !== 'plate') return;
    const target = mapCanvasRef.current;
    if (!target) return;

    const cw = containerSize.width;
    const ch = containerSize.height;
    if (target.width !== cw || target.height !== ch) {
      target.width = cw;
      target.height = ch;
    }

    const ctx = target.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = nightMode ? '#070102' : '#060B14';
    ctx.fillRect(0, 0, cw, ch);

    const srcW = sourceCanvas?.width ?? ANALYSIS_WIDTH;
    const srcH = sourceCanvas?.height ?? ANALYSIS_HEIGHT;
    const fitted = computeContainedRect(cw, ch, srcW, srcH);
    fittedRectRef.current = fitted;

    if (sourceCanvas) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(sourceCanvas, 0, 0, srcW, srcH, fitted.x, fitted.y, fitted.w, fitted.h);
    }

    if (showAnomalyHeatmap && anomalyField) {
      renderD3HeatmapOverlayPlate(
        ctx,
        anomalyField,
        fitted.x,
        fitted.y,
        fitted.w,
        fitted.h,
        nightMode ? 0.46 : 0.78
      );
    }

    if (nightMode) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = '#D92626';
      ctx.fillRect(fitted.x, fitted.y, fitted.w, fitted.h);
      ctx.restore();
    }

    if (showSolarTerminator) {
      renderSolarTerminatorPlate(
        ctx,
        solarPosition,
        fitted.x,
        fitted.y,
        fitted.w,
        fitted.h,
        nightMode
      );
    }

    // Crisp Natural Earth 50m political borders & coastlines over Plate Carrée map
    strokePackedLinesPlate(
      ctx,
      COUNTRY_BORDERS_RAD,
      fitted.x,
      fitted.y,
      fitted.w,
      fitted.h,
      nightMode ? 'rgba(185, 28, 28, 0.30)' : 'rgba(94, 234, 212, 0.28)',
      nightMode ? 0.65 : 0.75
    );
    strokePackedLinesPlate(
      ctx,
      COASTLINE_LINES_RAD,
      fitted.x,
      fitted.y,
      fitted.w,
      fitted.h,
      nightMode ? 'rgba(239, 68, 68, 0.52)' : 'rgba(241, 245, 249, 0.62)',
      nightMode ? 0.9 : 1.0
    );

    // Geodetic graticules & reticle mapped directly to the fitted Plate Carrée bounds
    ctx.save();
    ctx.strokeStyle = nightMode ? 'rgba(185, 28, 28, 0.20)' : 'rgba(94, 234, 212, 0.18)';
    ctx.lineWidth = 1;

    for (let lon = -150; lon <= 150; lon += 30) {
      const gx = fitted.x + ((lon + 180) / 360) * fitted.w;
      ctx.beginPath();
      ctx.moveTo(gx, fitted.y);
      ctx.lineTo(gx, fitted.y + fitted.h);
      ctx.stroke();
    }

    for (let lat = -60; lat <= 60; lat += 30) {
      const gy = fitted.y + ((90 - lat) / 180) * fitted.h;
      ctx.beginPath();
      ctx.moveTo(fitted.x, gy);
      ctx.lineTo(fitted.x + fitted.w, gy);
      ctx.stroke();
    }

    // Equator & Prime Meridian
    ctx.strokeStyle = nightMode ? 'rgba(220, 38, 38, 0.34)' : 'rgba(94, 234, 212, 0.36)';
    ctx.beginPath();
    ctx.moveTo(fitted.x, fitted.y + fitted.h / 2);
    ctx.lineTo(fitted.x + fitted.w, fitted.y + fitted.h / 2);
    ctx.moveTo(fitted.x + fitted.w / 2, fitted.y);
    ctx.lineTo(fitted.x + fitted.w / 2, fitted.y + fitted.h);
    ctx.stroke();

    // High-contrast bounding reticle
    const pad = 12;
    const arm = Math.min(22, Math.floor(Math.min(fitted.w, fitted.h) * 0.08));
    ctx.strokeStyle = nightMode ? '#DC2626' : '#5EEAD4';
    ctx.lineWidth = nightMode ? 1.5 : 2;
    ctx.beginPath();
    ctx.moveTo(fitted.x + pad, fitted.y + pad + arm);
    ctx.lineTo(fitted.x + pad, fitted.y + pad);
    ctx.lineTo(fitted.x + pad + arm, fitted.y + pad);

    ctx.moveTo(fitted.x + fitted.w - pad - arm, fitted.y + pad);
    ctx.lineTo(fitted.x + fitted.w - pad, fitted.y + pad);
    ctx.lineTo(fitted.x + fitted.w - pad, fitted.y + pad + arm);

    ctx.moveTo(fitted.x + pad, fitted.y + fitted.h - pad - arm);
    ctx.lineTo(fitted.x + pad, fitted.y + fitted.h - pad);
    ctx.lineTo(fitted.x + pad + arm, fitted.y + fitted.h - pad);

    ctx.moveTo(fitted.x + fitted.w - pad - arm, fitted.y + fitted.h - pad);
    ctx.lineTo(fitted.x + fitted.w - pad, fitted.y + fitted.h - pad);
    ctx.lineTo(fitted.x + fitted.w - pad, fitted.y + fitted.h - pad - arm);
    ctx.stroke();

    ctx.fillStyle = nightMode ? 'rgba(255, 92, 88, 0.78)' : 'rgba(241, 245, 249, 0.8)';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillText('90°N', fitted.x + 18, fitted.y + 26);
    ctx.fillText('00° EQ', fitted.x + 18, fitted.y + fitted.h / 2 - 6);
    ctx.fillText('90°S', fitted.x + 18, fitted.y + fitted.h - 18);
    ctx.restore();
  }, [
    projection,
    sourceCanvas,
    activeLayerKey,
    dateString,
    frameRevision,
    containerSize,
    showAnomalyHeatmap,
    anomalyField,
    showSolarTerminator,
    solarPosition,
    nightMode,
  ]);

  // Render Anti-Aliased Orthographic 3D Globe fitted cleanly to container dimensions
  useEffect(() => {
    if (projection !== 'globe') return;
    const canvas = globeCanvasRef.current;
    if (!canvas || !sourcePixels) return;

    const w = containerSize.width;
    const h = containerSize.height;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.43;

    const srcData = sourcePixels;
    const outImg = ctx.createImageData(w, h);
    const out = outImg.data;

    const phi0 = (globeCenter.lat * Math.PI) / 180;
    const lam0 = (globeCenter.lon * Math.PI) / 180;
    const sinPhi0 = Math.sin(phi0);
    const cosPhi0 = Math.cos(phi0);

    const bgR = nightMode ? 7 : 6;
    const bgG = nightMode ? 1 : 11;
    const bgB = nightMode ? 2 : 20;

    for (let i = 0; i < out.length; i += 4) {
      out[i] = bgR;
      out[i + 1] = bgG;
      out[i + 2] = bgB;
      out[i + 3] = 255;
    }

    const minY = Math.max(0, Math.floor(cy - R - 1));
    const maxY = Math.min(h - 1, Math.ceil(cy + R + 1));
    const minX = Math.max(0, Math.floor(cx - R - 1));
    const maxX = Math.min(w - 1, Math.ceil(cx + R + 1));

    for (let py = minY; py <= maxY; py++) {
      const y = (cy - py) / R;
      const ySq = y * y;
      for (let px = minX; px <= maxX; px++) {
        const x = (px - cx) / R;
        const rhoSq = x * x + ySq;
        if (rhoSq > 1.012) continue;

        const rho = Math.sqrt(rhoSq);
        const edgeAlpha = rho <= 0.988 ? 1.0 : Math.max(0, Math.min(1, (1.006 - rho) / 0.018));
        if (edgeAlpha <= 0) continue;

        const clampedRho = Math.min(1, rho);
        const cosC = Math.sqrt(Math.max(0, 1 - clampedRho * clampedRho));

        let latRad = phi0;
        let lonRad = lam0;
        if (clampedRho > 1e-6) {
          latRad = Math.asin(Math.max(-1, Math.min(1, cosC * sinPhi0 + y * cosPhi0)));
          lonRad = lam0 + Math.atan2(x, cosPhi0 * cosC - y * sinPhi0);
        }

        lonRad = ((((lonRad + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

        const sx = Math.min(
          ANALYSIS_WIDTH - 1,
          Math.max(0, Math.floor(((lonRad + Math.PI) / (2 * Math.PI)) * ANALYSIS_WIDTH))
        );
        const sy = Math.min(
          ANALYSIS_HEIGHT - 1,
          Math.max(0, Math.floor(((Math.PI / 2 - latRad) / Math.PI) * ANALYSIS_HEIGHT))
        );

        const sIdx = (sy * ANALYSIS_WIDTH + sx) * 4;
        const dIdx = (py * w + px) * 4;

        let baseR = srcData[sIdx];
        let baseG = srcData[sIdx + 1];
        let baseB = srcData[sIdx + 2];

        if (showAnomalyHeatmap && anomalyField) {
          const hData = anomalyField.heatmapData;
          const hAlpha = (hData[sIdx + 3] / 255) * (nightMode ? 0.46 : 0.78);
          baseR = baseR * (1 - hAlpha) + hData[sIdx] * hAlpha;
          baseG = baseG * (1 - hAlpha) + hData[sIdx + 1] * hAlpha;
          baseB = baseB * (1 - hAlpha) + hData[sIdx + 2] * hAlpha;
        }

        if (nightMode) {
          // Dark-adapted crimson optical filter attenuates high-luminance green/blue channels
          const lum = 0.299 * baseR + 0.587 * baseG + 0.114 * baseB;
          baseR = Math.min(255, lum * 0.8 + baseR * 0.14);
          baseG = baseG * 0.12;
          baseB = baseB * 0.08;
        }

        if (showSolarTerminator) {
          const cosZ =
            Math.sin(latRad) * solarPosition.sinDecl +
            Math.cos(latRad) *
              solarPosition.cosDecl *
              Math.cos(lonRad - solarPosition.subsolarLonRad);
          [baseR, baseG, baseB] = shadePixelBySolarCosZ(baseR, baseG, baseB, cosZ, nightMode);
        }

        const limbShade = 0.65 + 0.35 * cosC;
        const r = baseR * limbShade;
        const g = baseG * limbShade;
        const b = baseB * limbShade;

        out[dIdx] = Math.round(bgR + (r - bgR) * edgeAlpha);
        out[dIdx + 1] = Math.round(bgG + (g - bgG) * edgeAlpha);
        out[dIdx + 2] = Math.round(bgB + (b - bgB) * edgeAlpha);
        out[dIdx + 3] = 255;
      }
    }

    ctx.putImageData(outImg, 0, 0);

    if (showAnomalyHeatmap && anomalyField && !nightMode) {
      renderD3HeatmapContoursOrthographic(
        ctx,
        anomalyField,
        globeCenter.lat,
        globeCenter.lon,
        cx,
        cy,
        R
      );
    }

    // Crisp Natural Earth 50m political borders & coastlines projected onto the 3D sphere
    strokePackedLinesOrthographic(
      ctx,
      COUNTRY_BORDERS_RAD,
      phi0,
      lam0,
      cx,
      cy,
      R,
      nightMode ? 'rgba(185, 28, 28, 0.32)' : 'rgba(94, 234, 212, 0.34)',
      nightMode ? 0.7 : 0.85
    );
    strokePackedLinesOrthographic(
      ctx,
      COASTLINE_LINES_RAD,
      phi0,
      lam0,
      cx,
      cy,
      R,
      nightMode ? 'rgba(239, 68, 68, 0.56)' : 'rgba(241, 245, 249, 0.72)',
      nightMode ? 1.0 : 1.15
    );

    ctx.save();
    ctx.lineWidth = 1;
    for (let latDeg = -60; latDeg <= 60; latDeg += 30) {
      ctx.strokeStyle = nightMode
        ? latDeg === 0
          ? 'rgba(220, 38, 38, 0.35)'
          : 'rgba(185, 28, 28, 0.16)'
        : latDeg === 0
        ? 'rgba(94, 234, 212, 0.35)'
        : 'rgba(94, 234, 212, 0.14)';
      ctx.beginPath();
      let started = false;
      const latR = (latDeg * Math.PI) / 180;
      for (let lonDeg = -180; lonDeg <= 180; lonDeg += 4) {
        const pt = projectOrthographic(latR, (lonDeg * Math.PI) / 180, phi0, lam0, cx, cy, R);
        if (pt) {
          if (!started) {
            ctx.moveTo(pt[0], pt[1]);
            started = true;
          } else {
            ctx.lineTo(pt[0], pt[1]);
          }
        } else {
          started = false;
        }
      }
      ctx.stroke();
    }

    for (let lonDeg = -180; lonDeg < 180; lonDeg += 30) {
      ctx.strokeStyle = nightMode
        ? lonDeg === 0
          ? 'rgba(220, 38, 38, 0.35)'
          : 'rgba(185, 28, 28, 0.16)'
        : lonDeg === 0
        ? 'rgba(94, 234, 212, 0.35)'
        : 'rgba(94, 234, 212, 0.14)';
      ctx.beginPath();
      let started = false;
      const lonR = (lonDeg * Math.PI) / 180;
      for (let latDeg = -88; latDeg <= 88; latDeg += 4) {
        const pt = projectOrthographic((latDeg * Math.PI) / 180, lonR, phi0, lam0, cx, cy, R);
        if (pt) {
          if (!started) {
            ctx.moveTo(pt[0], pt[1]);
            started = true;
          } else {
            ctx.lineTo(pt[0], pt[1]);
          }
        } else {
          started = false;
        }
      }
      ctx.stroke();
    }

    ctx.strokeStyle = nightMode ? '#B91C1C' : '#5EEAD4';
    ctx.lineWidth = nightMode ? 1.15 : 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = nightMode ? 'rgba(185, 28, 28, 0.14)' : 'rgba(94, 234, 212, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 12, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = nightMode ? 'rgba(220, 38, 38, 0.28)' : 'rgba(94, 234, 212, 0.35)';
    ctx.beginPath();
    ctx.moveTo(cx - R - 20, cy);
    ctx.lineTo(cx - R - 4, cy);
    ctx.moveTo(cx + R + 4, cy);
    ctx.lineTo(cx + R + 20, cy);
    ctx.moveTo(cx, cy - R - 20);
    ctx.lineTo(cx, cy - R - 4);
    ctx.moveTo(cx, cy + R + 4);
    ctx.lineTo(cx, cy + R + 20);
    ctx.stroke();

    ctx.fillStyle = nightMode ? 'rgba(217, 72, 72, 0.85)' : 'rgba(148, 163, 184, 0.85)';
    ctx.font = '11px "JetBrains Mono", monospace';
    const cLatStr = `${Math.abs(globeCenter.lat).toFixed(0)}°${globeCenter.lat >= 0 ? 'N' : 'S'}`;
    const cLonStr = `${Math.abs(globeCenter.lon).toFixed(0)}°${globeCenter.lon >= 0 ? 'E' : 'W'}`;
    ctx.fillText(`ORBIT NADIR ${cLatStr} ${cLonStr}`, 14, h - 14);

    for (const bm of CLIMATE_BOOKMARKS) {
      const pt = projectOrthographic(
        (bm.lat * Math.PI) / 180,
        (bm.lon * Math.PI) / 180,
        phi0,
        lam0,
        cx,
        cy,
        R
      );
      if (pt) {
        const isCurrent = bm.layerKey === activeLayerKey;
        ctx.strokeStyle = nightMode
          ? isCurrent
            ? '#FF3B30'
            : 'rgba(217, 72, 72, 0.65)'
          : isCurrent
          ? '#5EEAD4'
          : 'rgba(241, 245, 249, 0.72)';
        ctx.lineWidth = nightMode ? 1.15 : 1.5;
        ctx.strokeRect(pt[0] - 5, pt[1] - 5, 10, 10);
        ctx.fillStyle = nightMode
          ? isCurrent
            ? '#FF3B30'
            : '#FF5C58'
          : isCurrent
          ? '#5EEAD4'
          : '#F1F5F9';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(bm.label, pt[0] + 8, pt[1] + 3);
      }
    }
    ctx.restore();

    if (showSolarTerminator) {
      renderSolarTerminatorOrthographic(
        ctx,
        solarPosition,
        globeCenter.lat,
        globeCenter.lon,
        cx,
        cy,
        R,
        nightMode
      );
    }
  }, [
    projection,
    sourcePixels,
    globeCenter,
    activeLayerKey,
    dateString,
    frameRevision,
    containerSize,
    showAnomalyHeatmap,
    anomalyField,
    showSolarTerminator,
    solarPosition,
    nightMode,
  ]);

  const samplePointTelemetry = (
    lon: number,
    lat: number
  ): {
    lumPct: number;
    deltaC: number;
    anomalyPct: number;
    solarElevDeg: number;
    solarRegime: SolarRegime;
    windSpeedMs: number | null;
    windBearingDeg: number | null;
    windOcean: boolean;
  } => {
    let lum255 = 0;
    if (sourcePixels) {
      const sx = Math.min(
        ANALYSIS_WIDTH - 1,
        Math.max(0, Math.floor(((lon + 180) / 360) * ANALYSIS_WIDTH))
      );
      const sy = Math.min(
        ANALYSIS_HEIGHT - 1,
        Math.max(0, Math.floor(((90 - lat) / 180) * ANALYSIS_HEIGHT))
      );
      const idx = (sy * ANALYSIS_WIDTH + sx) * 4;
      lum255 = 0.299 * sourcePixels[idx] + 0.587 * sourcePixels[idx + 1] + 0.114 * sourcePixels[idx + 2];
    }

    const lumPct = Math.round((lum255 / 255) * 100);
    const deltaC = anomalyField ? sampleDeltaAt(anomalyField, lon, lat) : 0;
    const thermalRatio = Math.min(1, Math.abs(deltaC) / ANOMALY_MAX_C);
    const localZRatio =
      layerLumStats.sigma > 1
        ? Math.min(1, Math.abs(lum255 - layerLumStats.mean) / (2.5 * layerLumStats.sigma))
        : 0;

    const combinedRatio = showAnomalyHeatmap
      ? thermalRatio
      : Math.min(1, thermalRatio * 0.65 + localZRatio * 0.35);

    const solarSample = sampleSolarAt(solarPosition, lon, lat);
    const windSample = windField ? sampleWindAtCoord(windField, lon, lat) : null;

    return {
      lumPct,
      deltaC,
      anomalyPct: Math.round(combinedRatio * 100),
      solarElevDeg: solarSample.elevationDeg,
      solarRegime: solarSample.regime,
      windSpeedMs: windSample ? windSample.speedMs : null,
      windBearingDeg: windSample ? windSample.bearingDeg : null,
      windOcean: windSample ? windSample.isOcean : false,
    };
  };

  const handlePlateMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const px = (cursorX / rect.width) * e.currentTarget.width;
    const py = (cursorY / rect.height) * e.currentTarget.height;
    const fitted = fittedRectRef.current;

    if (
      px < fitted.x ||
      px > fitted.x + fitted.w ||
      py < fitted.y ||
      py > fitted.y + fitted.h
    ) {
      setProbeInfo(null);
      return;
    }

    const nx = (px - fitted.x) / fitted.w;
    const ny = (py - fitted.y) / fitted.h;
    const lon = nx * 360 - 180;
    const lat = 90 - ny * 180;
    const telemetry = samplePointTelemetry(lon, lat);

    setProbeInfo({
      lat: `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`,
      lon: `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`,
      lumPct: telemetry.lumPct,
      anomalyPct: telemetry.anomalyPct,
      deltaC: telemetry.deltaC,
      solarElevDeg: telemetry.solarElevDeg,
      solarRegime: telemetry.solarRegime,
      windSpeedMs: telemetry.windSpeedMs,
      windBearingDeg: telemetry.windBearingDeg,
      windOcean: telemetry.windOcean,
      cursorX,
      cursorY,
      isDragging: false,
    });
  };

  const handleGlobePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { active: true, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    setProbeInfo((prev) => (prev ? { ...prev, isDragging: true } : null));
  };

  const handleGlobePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    let nextCenter = globeCenter;
    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      dragRef.current = { active: true, x: e.clientX, y: e.clientY };
      nextCenter = {
        lon: ((((globeCenter.lon - dx * 0.45 + 180) % 360) + 360) % 360) - 180,
        lat: Math.max(-85, Math.min(85, globeCenter.lat + dy * 0.4)),
      };
      setGlobeCenter(nextCenter);
    }

    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const w = e.currentTarget.width;
    const h = e.currentTarget.height;
    const px = (cursorX / rect.width) * w;
    const py = (cursorY / rect.height) * h;
    const R = Math.min(w, h) * 0.43;
    const x = (px - w / 2) / R;
    const y = (h / 2 - py) / R;
    const rhoSq = x * x + y * y;

    if (rhoSq <= 1) {
      const cosC = Math.sqrt(Math.max(0, 1 - rhoSq));
      const phi0 = (nextCenter.lat * Math.PI) / 180;
      const lam0 = (nextCenter.lon * Math.PI) / 180;
      const sinPhi0 = Math.sin(phi0);
      const cosPhi0 = Math.cos(phi0);

      let latRad = phi0;
      let lonRad = lam0;
      if (rhoSq > 1e-10) {
        latRad = Math.asin(Math.max(-1, Math.min(1, cosC * sinPhi0 + y * cosPhi0)));
        lonRad = lam0 + Math.atan2(x, cosPhi0 * cosC - y * sinPhi0);
      }
      const lat = (latRad * 180) / Math.PI;
      const lon = ((((((lonRad * 180) / Math.PI) + 180) % 360) + 360) % 360) - 180;
      const telemetry = samplePointTelemetry(lon, lat);

      setProbeInfo({
        lat: `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`,
        lon: `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`,
        lumPct: telemetry.lumPct,
        anomalyPct: telemetry.anomalyPct,
        deltaC: telemetry.deltaC,
        solarElevDeg: telemetry.solarElevDeg,
        solarRegime: telemetry.solarRegime,
        windSpeedMs: telemetry.windSpeedMs,
        windBearingDeg: telemetry.windBearingDeg,
        windOcean: telemetry.windOcean,
        cursorX,
        cursorY,
        isDragging: dragRef.current.active,
      });
    } else {
      setProbeInfo(null);
    }
  };

  const handleGlobePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current.active = false;
    setProbeInfo((prev) => (prev ? { ...prev, isDragging: false } : null));
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if not captured
    }
  };

  const layer = NASA_GIBS_LAYERS[activeLayerKey];

  return (
    <section
      aria-label="Planetary Satellite Observation Viewport"
      className="border border-[var(--border-grid)] bg-[var(--bg-console)] flex flex-col"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--border-grid)] bg-[var(--bg-panel)]">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] whitespace-nowrap">
            Orbital Observation Stage
          </h2>
          <span className="text-xs font-mono-tabular text-[var(--accent-mint)] truncate">
            {layer.cardinal} {layer.azimuthLabel} · {layer.phenomenon}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggleSolarTerminator}
            aria-pressed={showSolarTerminator}
            title="Toggle real-time UTC Solar Terminators shadow overlay (Shortcut: T)"
            className={`px-2.5 py-1 border text-xs font-mono-tabular flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              showSolarTerminator
                ? 'bg-[var(--accent-amber)] border-[var(--accent-amber)] text-[var(--bg-obsidian)] font-semibold'
                : 'bg-[var(--bg-obsidian)] border-[var(--border-grid)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent-amber)]'
            }`}
          >
            <Sun className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Solar Terminators</span>
          </button>

          <button
            type="button"
            onClick={onToggleAnomalyHeatmap}
            aria-pressed={showAnomalyHeatmap}
            title="Toggle D3 Climate Anomaly Heatmap overlay (Shortcut: A)"
            className={`px-2.5 py-1 border text-xs font-mono-tabular flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
              showAnomalyHeatmap
                ? 'bg-[var(--accent-coral)] border-[var(--accent-coral)] text-[var(--bg-obsidian)] font-semibold'
                : 'bg-[var(--bg-obsidian)] border-[var(--border-grid)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent-coral)]'
            }`}
          >
            <Thermometer className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Climate Anomaly Heatmap</span>
          </button>

          <div
            className="flex border border-[var(--border-grid)] bg-[var(--bg-obsidian)]"
            role="group"
            aria-label="Projection Mode"
          >
            <button
              type="button"
              onClick={() => onToggleProjection('globe')}
              aria-pressed={projection === 'globe'}
              className={`px-2.5 py-1 text-xs font-mono-tabular flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                projection === 'globe'
                  ? 'bg-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Globe className="w-3.5 h-3.5" aria-hidden="true" />
              <span>3D Globe</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleProjection('plate')}
              aria-pressed={projection === 'plate'}
              className={`px-2.5 py-1 text-xs font-mono-tabular flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                projection === 'plate'
                  ? 'bg-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" aria-hidden="true" />
              <span>EPSG:4326</span>
            </button>
          </div>
        </div>
      </div>

      {/* Aspect-aware display container (2:1 natural Plate Carrée footprint, ResizeObserver-driven) */}
      <div className="bg-[var(--bg-obsidian)] p-3">
        <div
          ref={containerRef}
          className="relative w-full aspect-[2/1] min-h-[220px] border border-[var(--border-grid)] bg-[var(--bg-obsidian)] overflow-hidden"
        >
          {projection === 'globe' ? (
            <canvas
              id="orbital-globe"
              ref={globeCanvasRef}
              onPointerDown={handleGlobePointerDown}
              onPointerMove={handleGlobePointerMove}
              onPointerUp={handleGlobePointerUp}
              onPointerLeave={() => {
                dragRef.current.active = false;
                setProbeInfo(null);
              }}
              className="w-full h-full block cursor-grab active:cursor-grabbing bg-[var(--bg-obsidian)]"
              aria-label={`Interactive 3D orthographic Earth globe showing ${layer.phenomenon} for ${dateString}`}
            />
          ) : (
            <canvas
              id="satellite-map"
              ref={mapCanvasRef}
              onMouseMove={handlePlateMove}
              onMouseLeave={() => setProbeInfo(null)}
              className="w-full h-full block cursor-crosshair bg-[var(--bg-obsidian)]"
              aria-label={`Plate Carree map displaying ${layer.phenomenon} for ${dateString}`}
            />
          )}

          {probeInfo && !probeInfo.isDragging && (() => {
            const tooltipW = 228;
            const tooltipH = (showSolarTerminator ? 98 : 78) + (probeInfo.windSpeedMs !== null ? 20 : 0);
            const margin = 14;
            const left =
              probeInfo.cursorX + margin + tooltipW > containerSize.width
                ? Math.max(8, probeInfo.cursorX - tooltipW - margin)
                : probeInfo.cursorX + margin;
            const top =
              probeInfo.cursorY + margin + tooltipH > containerSize.height
                ? Math.max(8, probeInfo.cursorY - tooltipH - margin)
                : Math.max(8, probeInfo.cursorY + margin);

            const isHighAnomaly = probeInfo.anomalyPct >= 60;
            const isElevatedAnomaly = probeInfo.anomalyPct >= 35 && probeInfo.anomalyPct < 60;
            const accentHex = nightMode
              ? isHighAnomaly
                ? '#FF6B4A'
                : isElevatedAnomaly
                ? '#E04826'
                : '#FF3B30'
              : isHighAnomaly
              ? '#FB7185'
              : isElevatedAnomaly
              ? '#F59E0B'
              : '#5EEAD4';

            return (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute z-20 w-[228px] border px-2.5 py-2 font-mono-tabular text-[11px] leading-snug"
                style={{
                  left: `${left}px`,
                  top: `${top}px`,
                  borderColor: accentHex,
                  backgroundColor: nightMode ? 'rgba(7, 1, 2, 0.95)' : 'rgba(6, 11, 20, 0.95)',
                }}
              >
                <div className="flex items-center justify-between text-[var(--text-primary)] font-semibold">
                  <span>{probeInfo.lat}</span>
                  <span>{probeInfo.lon}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px]">
                  <span className="text-[var(--text-muted)]">ANOMALY INTENSITY</span>
                  <span className="font-semibold" style={{ color: accentHex }}>
                    {probeInfo.anomalyPct}%
                  </span>
                </div>
                <div className="mt-1 h-1 w-full bg-[var(--bg-panel)] border border-[var(--border-grid)]">
                  <div
                    className="h-full"
                    style={{
                      width: `${probeInfo.anomalyPct}%`,
                      backgroundColor: accentHex,
                    }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                  <span>
                    ΔT {probeInfo.deltaC >= 0 ? '+' : ''}
                    {probeInfo.deltaC.toFixed(2)}°C
                  </span>
                  <span>LUM {probeInfo.lumPct}%</span>
                </div>
                {probeInfo.windSpeedMs !== null && (
                  <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                    <span>
                      WIND {probeInfo.windSpeedMs.toFixed(1)} m/s @{' '}
                      {String(Math.round(probeInfo.windBearingDeg ?? 0)).padStart(3, '0')}°
                    </span>
                    <span className={probeInfo.windOcean ? 'text-[var(--accent-mint)]' : ''}>
                      {probeInfo.windOcean ? 'OCEAN' : 'LAND'}
                    </span>
                  </div>
                )}
                {showSolarTerminator && (
                  <div className="mt-1 pt-1 border-t border-[var(--border-grid)] flex items-center justify-between text-[10px]">
                    <span
                      className={
                        probeInfo.solarRegime === 'DAYLIT'
                          ? 'text-[var(--accent-amber)]'
                          : probeInfo.solarRegime === 'NIGHT SHADOW'
                          ? 'text-[var(--text-muted)]'
                          : 'text-[var(--accent-mint)]'
                      }
                    >
                      {probeInfo.solarRegime}
                    </span>
                    <span className="text-[var(--text-muted)]">
                      SUN {probeInfo.solarElevDeg >= 0 ? '+' : ''}
                      {probeInfo.solarElevDeg.toFixed(1)}°
                    </span>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {showSolarTerminator && (
        <div
          aria-label="Live UTC Solar Terminator Ephemeris"
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-t border-[var(--border-grid)] bg-[var(--bg-panel)] text-[11px] font-mono-tabular"
        >
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[var(--accent-amber)] font-semibold whitespace-nowrap">
              SOLAR TERMINATOR · {solarPosition.utcTimeStr}
            </span>
            <span className="text-[var(--text-muted)] flex items-center gap-1.5 whitespace-nowrap">
              <span className="inline-block w-3 h-[2px] bg-[var(--accent-amber)]" aria-hidden="true" />
              0° Sunset / Sunrise
            </span>
            <span className="text-[var(--text-muted)] flex items-center gap-1.5 whitespace-nowrap">
              <span
                className="inline-block w-3 border-t border-dashed border-[var(--text-muted)]"
                aria-hidden="true"
              />
              -6° Civil Twilight
            </span>
          </div>

          <div className="flex items-center gap-4 text-[var(--text-muted)] flex-wrap">
            <span>
              SUBSOLAR{' '}
              <strong className="text-[var(--accent-amber)]">
                {formatCoordLat(solarPosition.subsolarLatDeg)}{' '}
                {formatCoordLon(solarPosition.subsolarLonDeg)}
              </strong>
            </span>
            <span>
              DECL{' '}
              <strong className="text-[var(--text-primary)]">
                {solarPosition.declinationDeg >= 0 ? '+' : ''}
                {solarPosition.declinationDeg.toFixed(2)}°
              </strong>
            </span>
          </div>
        </div>
      )}

      {showAnomalyHeatmap && anomalyField && (
        <div
          aria-label="D3 Temperature Variance Heatmap Scale"
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-t border-[var(--border-grid)] bg-[var(--bg-panel)] text-[11px] font-mono-tabular"
        >
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[var(--accent-coral)] font-semibold whitespace-nowrap">
              D3 THERMAL VARIANCE (ΔT °C)
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[var(--text-muted)]">{ANOMALY_MIN_C.toFixed(1)}°C</span>
              <div
                className={`flex border border-[var(--border-grid)] h-3 ${nightMode ? 'opacity-70' : ''}`}
                role="img"
                aria-label="D3 RdBu diverging temperature anomaly ramp from -3.5 to +3.5 degrees Celsius"
              >
                {legendStops.map((stop) => (
                  <span
                    key={stop.tempC}
                    title={`${stop.tempC >= 0 ? '+' : ''}${stop.tempC.toFixed(1)}°C`}
                    className="w-5 h-full block"
                    style={{ backgroundColor: stop.color }}
                  />
                ))}
              </div>
              <span className="text-[var(--text-muted)]">+{ANOMALY_MAX_C.toFixed(1)}°C</span>
            </div>
          </div>

          <div className="flex items-center gap-4 text-[var(--text-muted)]">
            <span>
              MEAN{' '}
              <strong className="text-[var(--text-primary)]">
                {anomalyField.stats.meanC >= 0 ? '+' : ''}
                {anomalyField.stats.meanC.toFixed(2)}°C
              </strong>
            </span>
            <span>
              PEAK{' '}
              <strong className="text-[var(--accent-coral)]">
                +{anomalyField.stats.maxC.toFixed(2)}°C
              </strong>
            </span>
            <span>
              MIN{' '}
              <strong className="text-[var(--accent-mint)]">
                {anomalyField.stats.minC >= 0 ? '+' : ''}
                {anomalyField.stats.minC.toFixed(2)}°C
              </strong>
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-t border-[var(--border-grid)] bg-[var(--bg-console)] text-xs font-mono-tabular">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Climate Region Bookmarks">
          <span className="text-[var(--text-muted)] mr-1">TARGETS:</span>
          {CLIMATE_BOOKMARKS.map((bm) => (
            <button
              key={bm.id}
              type="button"
              onClick={() => {
                setGlobeCenter({ lat: bm.lat, lon: bm.lon });
                onSelectBookmark(bm.layerKey, bm.label);
              }}
              className={`px-2 py-0.5 border text-[11px] cursor-pointer whitespace-nowrap ${
                activeLayerKey === bm.layerKey
                  ? 'border-[var(--accent-mint)] text-[var(--accent-mint)] bg-[var(--bg-panel)]'
                  : 'border-[var(--border-grid)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent-mint)]'
              }`}
            >
              {bm.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4 text-[var(--text-muted)]">
          <span>
            {probeInfo
              ? `PROBE ${probeInfo.lat} ${probeInfo.lon} · ANOMALY ${probeInfo.anomalyPct}% · ΔT ${
                  probeInfo.deltaC >= 0 ? '+' : ''
                }${probeInfo.deltaC.toFixed(2)}°C`
              : projection === 'globe'
              ? 'DRAG GLOBE TO ORBIT · HOVER TO PROBE'
              : 'HOVER MAP TO PROBE LAT/LON'}
          </span>
          <span className="text-[var(--text-primary)]">{isLoading ? 'SYNCING...' : dataSource}</span>
        </div>
      </div>
    </section>
  );
};
