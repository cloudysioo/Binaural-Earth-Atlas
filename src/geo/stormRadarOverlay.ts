import * as d3 from 'd3';
import { sampleWindAtCoord, WindVectorField } from '../analysis/windVectorField';
import { BeaThemePalette, resolveTheme } from '../theme/themes';
import { WindFittedRect } from './windFlowOverlay';

export const STORM_GRID_COLS = 72; // 5° longitude grid for fluid 60fps D3 contours
export const STORM_GRID_ROWS = 36; // 5° latitude grid
export const AMBIENT_SLP_HPA = 1013;

const DEG2RAD = Math.PI / 180;

export interface StormSystemCore {
  id: string;
  label: string;
  baseLatDeg: number;
  baseLonDeg: number;
  baseDepthHpa: number;
  radiusDeg: number;
  spinSign: 1 | -1; // +1 CCW (Northern Hemisphere), -1 CW (Southern Hemisphere)
  driftDegPerSec: number;
  phaseOffset: number;
}

export interface StormRadarModel {
  dateString: string;
  cores: StormSystemCore[];
  deepestBaseHpa: number;
}

export interface StormPressureLegendStop {
  pressureHpa: number;
  deficitHpa: number;
  label: string;
  color: string;
  nightColor: string;
  dashed?: boolean;
  lineWidth: number;
}

export const STORM_RADAR_LEGEND_STOPS: StormPressureLegendStop[] = [
  {
    pressureHpa: 1004,
    deficitHpa: 9,
    label: '1004 hPa',
    color: '#38BDF8',
    nightColor: '#991B1B',
    dashed: true,
    lineWidth: 0.9,
  },
  {
    pressureHpa: 996,
    deficitHpa: 17,
    label: '996 hPa',
    color: '#5EEAD4',
    nightColor: '#B91C1C',
    lineWidth: 1.15,
  },
  {
    pressureHpa: 984,
    deficitHpa: 29,
    label: '984 hPa',
    color: '#F59E0B',
    nightColor: '#DC2626',
    lineWidth: 1.4,
  },
  {
    pressureHpa: 972,
    deficitHpa: 41,
    label: '972 hPa',
    color: '#FB7185',
    nightColor: '#FF453A',
    lineWidth: 1.7,
  },
  {
    pressureHpa: 960,
    deficitHpa: 53,
    label: '≤960 hPa',
    color: '#FDE047',
    nightColor: '#FF7875',
    lineWidth: 2.0,
  },
];

interface BasinSeed {
  id: string;
  label: string;
  latRange: [number, number];
  lonRange: [number, number];
  fallbackLat: number;
  fallbackLon: number;
  fallbackDepth: number;
  radiusDeg: number;
  driftDegPerSec: number;
  phaseOffset: number;
}

const PLANETARY_STORM_BASINS: BasinSeed[] = [
  {
    id: 'natl',
    label: 'NATL-L1',
    latRange: [40, 66],
    lonRange: [-58, -6],
    fallbackLat: 54,
    fallbackLon: -34,
    fallbackDepth: 34,
    radiusDeg: 18.5,
    driftDegPerSec: 0.95,
    phaseOffset: 0.4,
  },
  {
    id: 'npac',
    label: 'NPAC-L2',
    latRange: [38, 62],
    lonRange: [148, 178],
    fallbackLat: 49,
    fallbackLon: 164,
    fallbackDepth: 32,
    radiusDeg: 19.0,
    driftDegPerSec: 0.85,
    phaseOffset: 1.9,
  },
  {
    id: 'alaska',
    label: 'GOAK-L3',
    latRange: [44, 62],
    lonRange: [-168, -126],
    fallbackLat: 53,
    fallbackLon: -148,
    fallbackDepth: 28,
    radiusDeg: 16.5,
    driftDegPerSec: 0.78,
    phaseOffset: 3.1,
  },
  {
    id: 'barents',
    label: 'BARN-L4',
    latRange: [65, 80],
    lonRange: [8, 72],
    fallbackLat: 73,
    fallbackLon: 38,
    fallbackDepth: 26,
    radiusDeg: 15.5,
    driftDegPerSec: 0.62,
    phaseOffset: 4.5,
  },
  {
    id: 'drake',
    label: 'DRKE-L5',
    latRange: [-66, -42],
    lonRange: [-95, -28],
    fallbackLat: -56,
    fallbackLon: -62,
    fallbackDepth: 38,
    radiusDeg: 20.0,
    driftDegPerSec: 1.1,
    phaseOffset: 2.6,
  },
  {
    id: 'sind',
    label: 'SIND-L6',
    latRange: [-62, -40],
    lonRange: [42, 114],
    fallbackLat: -51,
    fallbackLon: 76,
    fallbackDepth: 35,
    radiusDeg: 19.5,
    driftDegPerSec: 1.0,
    phaseOffset: 5.2,
  },
  {
    id: 'spac',
    label: 'SPAC-L7',
    latRange: [-64, -40],
    lonRange: [-174, -108],
    fallbackLat: -51,
    fallbackLon: -144,
    fallbackDepth: 31,
    radiusDeg: 18.5,
    driftDegPerSec: 0.92,
    phaseOffset: 1.1,
  },
];

function wrapLonDeg(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Extracts active baroclinic low-pressure storm centers from the global WindVectorField
 * (or seasonal orbital climatology when wind grid is unavailable).
 */
export function buildStormRadarModel(
  windField: WindVectorField | null,
  dateString: string
): StormRadarModel {
  const month = clamp(parseInt(dateString.split('-')[1] || '11', 10), 1, 12);
  const nhWinterBoost = Math.cos(((month - 1) / 12) * Math.PI * 2); // +1 Jan, -1 Jul

  const cores: StormSystemCore[] = PLANETARY_STORM_BASINS.map((basin) => {
    let bestLat = basin.fallbackLat;
    let bestLon = basin.fallbackLon;
    let bestSpeed = 0;

    if (windField) {
      for (let lat = basin.latRange[0]; lat <= basin.latRange[1]; lat += 4) {
        for (let lon = basin.lonRange[0]; lon <= basin.lonRange[1]; lon += 6) {
          const sample = sampleWindAtCoord(windField, lon, lat);
          const score = sample.speedMs * (sample.isOcean ? 1.12 : 0.78) + sample.turbulence * 4.5;
          if (score > bestSpeed) {
            bestSpeed = score;
            bestLat = lat;
            bestLon = lon;
          }
        }
      }
    }

    const isNH = bestLat >= 0;
    const seasonalScale = isNH ? 1 + nhWinterBoost * 0.16 : 1 - nhWinterBoost * 0.12;
    const windDerivedDepth = windField
      ? clamp((bestSpeed - 6) * 1.45, 16, 42)
      : basin.fallbackDepth;

    return {
      id: basin.id,
      label: basin.label,
      baseLatDeg: bestLat,
      baseLonDeg: bestLon,
      baseDepthHpa: windDerivedDepth * seasonalScale,
      radiusDeg: basin.radiusDeg,
      spinSign: isNH ? 1 : -1,
      driftDegPerSec: basin.driftDegPerSec,
      phaseOffset: basin.phaseOffset,
    };
  });

  const maxDepth = d3.max(cores, (c) => c.baseDepthHpa) ?? 34;

  return {
    dateString,
    cores,
    deepestBaseHpa: Math.round(AMBIENT_SLP_HPA - maxDepth),
  };
}

function getCorePositionAtTime(
  core: StormSystemCore,
  timeSec: number,
  intensity: number
): { latDeg: number; lonDeg: number; depthHpa: number; radiusDeg: number } {
  // Subtle synoptic oscillation around storm track anchor so systems stay aligned with oceans
  const wobbleLon = Math.sin(timeSec * 0.24 * core.driftDegPerSec + core.phaseOffset) * 5.2;
  const wobbleLat =
    Math.cos(timeSec * 0.19 * core.driftDegPerSec + core.phaseOffset * 1.3) * 2.4;

  return {
    latDeg: clamp(core.baseLatDeg + wobbleLat, -82, 82),
    lonDeg: wrapLonDeg(core.baseLonDeg + wobbleLon),
    depthHpa: core.baseDepthHpa * (0.28 + intensity * 0.84),
    radiusDeg: core.radiusDeg * (0.86 + Math.min(1.4, intensity) * 0.24),
  };
}

/**
 * Evaluates sea-level pressure deficit (hPa below 1013 hPa ambient) at (lonDeg, latDeg)
 * with animated cyclonic spiral arms matching Coriolis spin direction.
 */
function evaluatePressureDeficitAt(
  model: StormRadarModel,
  lonDeg: number,
  latDeg: number,
  intensity: number,
  timeSec: number,
  resolvedCores?: Array<{
    latDeg: number;
    lonDeg: number;
    depthHpa: number;
    radiusDeg: number;
    spinSign: 1 | -1;
    phaseOffset: number;
  }>
): number {
  if (intensity <= 0.01) return 0;

  const cosLat = Math.max(0.24, Math.cos(latDeg * DEG2RAD));
  const swirlSpeed = 0.9 + intensity * 1.45;

  // Ambient baroclinic zonal trough modulation along polar/subpolar jet belts
  const jetTrough =
    (Math.exp(-Math.pow((latDeg - 52) / 14, 2)) + Math.exp(-Math.pow((latDeg + 54) / 14, 2))) *
    (3.8 + 2.2 * Math.sin(lonDeg * 3 * DEG2RAD - timeSec * 0.45 * swirlSpeed)) *
    Math.min(1.3, intensity);

  let deficit = jetTrough;
  const count = model.cores.length;

  for (let i = 0; i < count; i++) {
    const core = model.cores[i];
    const dyn = resolvedCores ? resolvedCores[i] : getCorePositionAtTime(core, timeSec, intensity);

    const dLon = wrapLonDeg(lonDeg - dyn.lonDeg);
    const dx = dLon * cosLat;
    const dy = latDeg - dyn.latDeg;
    const distSq = dx * dx + dy * dy;
    const maxRange = dyn.radiusDeg * 2.45;
    if (distSq > maxRange * maxRange) continue;

    const dist = Math.sqrt(distSq);
    const normR = dist / dyn.radiusDeg;
    const env = Math.exp(-0.5 * normR * normR);

    // Coriolis cyclonic spiral bands: rotate smoothly and trail outward from storm eye
    const theta = Math.atan2(dy, dx);
    const armMask = clamp((normR - 0.18) * 1.5, 0, 1);
    const spiralPhase =
      2 * theta - core.spinSign * (normR * 3.1 - timeSec * swirlSpeed * 1.8) + core.phaseOffset;
    const spiralMod = 1 + 0.28 * armMask * Math.cos(spiralPhase);

    deficit += dyn.depthHpa * env * spiralMod;
  }

  return Math.max(0, deficit);
}

/**
 * Samples live Sea-Level Pressure (hPa) at a cursor probe coordinate when Storm Radar is enabled.
 */
export function sampleStormPressureHpa(
  model: StormRadarModel,
  lonDeg: number,
  latDeg: number,
  intensity: number,
  timeSec: number
): number {
  const deficit = evaluatePressureDeficitAt(model, lonDeg, latDeg, intensity, timeSec);
  return clamp(AMBIENT_SLP_HPA - deficit, 938, 1020);
}

const deficitBuffer = new Array<number>(STORM_GRID_COLS * STORM_GRID_ROWS).fill(0);

const pressureStrokeScale = d3
  .scaleLinear<string>()
  .domain(STORM_RADAR_LEGEND_STOPS.map((s) => s.deficitHpa))
  .range(STORM_RADAR_LEGEND_STOPS.map((s) => s.color))
  .clamp(true);

const nightPressureStrokeScale = d3
  .scaleLinear<string>()
  .domain(STORM_RADAR_LEGEND_STOPS.map((s) => s.deficitHpa))
  .range(STORM_RADAR_LEGEND_STOPS.map((s) => s.nightColor))
  .clamp(true);

function projectOrthographicCore(
  latDeg: number,
  lonDeg: number,
  phi0: number,
  lam0: number,
  cx: number,
  cy: number,
  R: number
): { x: number; y: number; cosC: number } | null {
  const latRad = latDeg * DEG2RAD;
  const lonRad = lonDeg * DEG2RAD;
  const sinPhi0 = Math.sin(phi0);
  const cosPhi0 = Math.cos(phi0);
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const dLon = lonRad - lam0;
  const cosC = sinPhi0 * sinLat + cosPhi0 * cosLat * Math.cos(dLon);
  if (cosC < 0.08) return null;

  return {
    x: cx + R * cosLat * Math.sin(dLon),
    y: cy - R * (cosPhi0 * sinLat - sinPhi0 * cosLat * Math.cos(dLon)),
    cosC,
  };
}

export interface RenderStormRadarParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  projection: 'globe' | 'plate';
  model: StormRadarModel;
  intensity: number;
  timeSec: number;
  globeCenter: { lat: number; lon: number };
  fittedRect: WindFittedRect;
  nightMode: boolean;
  theme?: BeaThemePalette;
}

/**
 * Computes animated D3 pressure-contour bands (`d3.contours()` + `d3.geoPath()`)
 * and renders dynamic swirling storm isobars and low-pressure eye reticles
 * onto either the 3D Orthographic Globe or 2D EPSG:4326 Plate Carrée viewport.
 */
export function renderStormRadarOverlay({
  ctx,
  width,
  height,
  projection,
  model,
  intensity,
  timeSec,
  globeCenter,
  fittedRect,
  nightMode,
  theme,
}: RenderStormRadarParams): { activeCores: number; deepestHpa: number } {
  ctx.clearRect(0, 0, width, height);
  if (width <= 0 || height <= 0 || intensity <= 0.01) {
    return { activeCores: 0, deepestHpa: AMBIENT_SLP_HPA };
  }
  const pal = resolveTheme(theme, nightMode);
  const cTheme = pal.canvas;

  const resolvedCores = model.cores.map((core) => ({
    ...getCorePositionAtTime(core, timeSec, intensity),
    id: core.id,
    label: core.label,
    spinSign: core.spinSign,
    phaseOffset: core.phaseOffset,
  }));

  let maxDeficit = 0;
  for (let r = 0; r < STORM_GRID_ROWS; r++) {
    const latDeg = 90 - ((r + 0.5) / STORM_GRID_ROWS) * 180;
    for (let c = 0; c < STORM_GRID_COLS; c++) {
      const lonDeg = ((c + 0.5) / STORM_GRID_COLS) * 360 - 180;
      const d = evaluatePressureDeficitAt(
        model,
        lonDeg,
        latDeg,
        intensity,
        timeSec,
        resolvedCores
      );
      deficitBuffer[r * STORM_GRID_COLS + c] = d;
      if (d > maxDeficit) maxDeficit = d;
    }
  }

  // Generate GeoJSON MultiPolygon pressure isobars via d3.contours()
  const thresholds = STORM_RADAR_LEGEND_STOPS.map((s) => s.deficitHpa);
  const rawContours = d3
    .contours()
    .size([STORM_GRID_COLS, STORM_GRID_ROWS])
    .smooth(true)
    .thresholds(thresholds)(deficitBuffer);

  const cx = width / 2;
  const cy = height / 2;
  const R = Math.min(width, height) * 0.43;

  const geoProjection =
    projection === 'globe'
      ? d3
          .geoOrthographic()
          .rotate([-globeCenter.lon, -globeCenter.lat])
          .scale(R)
          .translate([cx, cy])
          .clipAngle(90)
      : d3.geoEquirectangular().fitExtent(
          [
            [fittedRect.x, fittedRect.y],
            [fittedRect.x + fittedRect.w, fittedRect.y + fittedRect.h],
          ],
          { type: 'Sphere' }
        );

  const geoPath = d3.geoPath(geoProjection, ctx);

  ctx.save();
  ctx.beginPath();
  if (projection === 'globe') {
    ctx.arc(cx, cy, Math.max(4, R - 0.5), 0, Math.PI * 2);
  } else {
    ctx.rect(fittedRect.x, fittedRect.y, fittedRect.w, fittedRect.h);
  }
  ctx.clip();

  const colorScale = d3
    .scaleLinear<string>()
    .domain(STORM_RADAR_LEGEND_STOPS.map((s) => s.deficitHpa))
    .range(cTheme.stormStops)
    .clamp(true);
  const alphaBoost = clamp(0.45 + intensity * 0.35, 0.35, 1.0);

  for (let idx = 0; idx < rawContours.length; idx++) {
    const mp = rawContours[idx];
    if (mp.coordinates.length === 0) continue;

    const stop = STORM_RADAR_LEGEND_STOPS[idx];
    const strokeCol = d3.rgb(colorScale(mp.value));
    const bandAlpha = clamp((0.46 + idx * 0.13) * alphaBoost, 0.25, 0.96);
    const fillAlpha = clamp((0.035 + idx * 0.025) * alphaBoost, 0.02, 0.22);

    const geoCoordinates = mp.coordinates.map((polygon) =>
      polygon.map((ring) =>
        ring.map(([gx, gy]) => [
          (gx / STORM_GRID_COLS) * 360 - 180,
          90 - (gy / STORM_GRID_ROWS) * 180,
        ])
      )
    );

    ctx.beginPath();
    geoPath({
      type: 'MultiPolygon',
      coordinates: geoCoordinates,
    });

    ctx.fillStyle = `rgba(${Math.round(strokeCol.r)}, ${Math.round(strokeCol.g)}, ${Math.round(
      strokeCol.b
    )}, ${fillAlpha.toFixed(3)})`;
    ctx.fill();

    ctx.strokeStyle = `rgba(${Math.round(strokeCol.r)}, ${Math.round(strokeCol.g)}, ${Math.round(
      strokeCol.b
    )}, ${bandAlpha.toFixed(3)})`;
    ctx.lineWidth = (stop?.lineWidth ?? 1.2) * (0.85 + Math.min(1.4, intensity) * 0.22);
    ctx.setLineDash(stop?.dashed ? [4, 4] : []);
    ctx.stroke();
  }

  ctx.setLineDash([]);

  // Render rotating cyclonic eye markers & central barometric pressure tags
  const phi0 = globeCenter.lat * DEG2RAD;
  const lam0 = globeCenter.lon * DEG2RAD;
  const activeCoreThresholdHpa = 998;
  let activeCount = 0;

  ctx.font = '600 10px "JetBrains Mono", monospace';
  ctx.textBaseline = 'middle';

  for (const core of resolvedCores) {
    const coreHpa = Math.round(
      clamp(
        AMBIENT_SLP_HPA -
          evaluatePressureDeficitAt(
            model,
            core.lonDeg,
            core.latDeg,
            intensity,
            timeSec,
            resolvedCores
          ),
        940,
        1014
      )
    );

    if (coreHpa > activeCoreThresholdHpa) continue;
    activeCount++;

    let screenPt: { x: number; y: number; cosC: number } | null = null;
    if (projection === 'globe') {
      screenPt = projectOrthographicCore(core.latDeg, core.lonDeg, phi0, lam0, cx, cy, R);
    } else {
      screenPt = {
        x: fittedRect.x + ((core.lonDeg + 180) / 360) * fittedRect.w,
        y: fittedRect.y + ((90 - core.latDeg) / 180) * fittedRect.h,
        cosC: 1,
      };
    }

    if (!screenPt) continue;

    const isSevere = coreHpa <= 974;
    const isModerate = coreHpa <= 986;
    const coreColor = isSevere
      ? cTheme.secondary
      : isModerate
      ? cTheme.tertiary
      : cTheme.primary;

    const eyeAlpha = clamp(screenPt.cosC * 1.4, 0.35, 0.98);
    ctx.save();
    ctx.globalAlpha = eyeAlpha;
    ctx.translate(screenPt.x, screenPt.y);

    // Outer rotating radar bracket
    ctx.save();
    ctx.rotate(core.spinSign * timeSec * (0.75 + intensity * 0.65));
    ctx.strokeStyle = coreColor;
    ctx.lineWidth = isSevere ? 1.4 : 1.1;
    const rTick = isSevere ? 9 : 7;
    ctx.beginPath();
    ctx.moveTo(-rTick, -3);
    ctx.lineTo(-rTick, -rTick);
    ctx.lineTo(-3, -rTick);
    ctx.moveTo(3, -rTick);
    ctx.lineTo(rTick, -rTick);
    ctx.lineTo(rTick, -3);
    ctx.moveTo(rTick, 3);
    ctx.lineTo(rTick, rTick);
    ctx.lineTo(3, rTick);
    ctx.moveTo(-3, rTick);
    ctx.lineTo(-rTick, rTick);
    ctx.lineTo(-rTick, 3);
    ctx.stroke();
    ctx.restore();

    // Central 'L' box + live barometric readout
    ctx.fillStyle = cTheme.bgTooltip;
    ctx.fillRect(-5, -5, 10, 10);
    ctx.strokeStyle = coreColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(-5, -5, 10, 10);

    ctx.fillStyle = coreColor;
    ctx.textAlign = 'center';
    ctx.fillText('L', 0, 0.5);

    ctx.textAlign = 'left';
    const tag = `${core.label} ${coreHpa}`;
    const tagW = ctx.measureText(tag).width + 6;
    ctx.fillStyle = cTheme.bgTooltip;
    ctx.fillRect(10, -7, tagW, 14);
    ctx.strokeStyle = `rgba(${cTheme.primaryRgb}, 0.42)`;
    ctx.strokeRect(10, -7, tagW, 14);
    ctx.fillStyle = coreColor;
    ctx.fillText(tag, 13, 0.5);

    ctx.restore();
  }

  ctx.restore();

  const deepestHpa = Math.round(clamp(AMBIENT_SLP_HPA - maxDeficit, 938, AMBIENT_SLP_HPA));
  return {
    activeCores: Math.max(activeCount, resolvedCores.length),
    deepestHpa,
  };
}
