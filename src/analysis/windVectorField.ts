import { LAND_POLYGONS_DEG } from '../geo/worldBorders';

export const WIND_GRID_COLS = 72; // 5° longitude resolution
export const WIND_GRID_ROWS = 36; // 5° latitude resolution

export interface WindSample {
  u: number; // Zonal wind m/s (+ = eastward / westerly)
  v: number; // Meridional wind m/s (+ = northward / southerly)
  speedMs: number; // Magnitude m/s
  bearingDeg: number; // Vector direction clockwise from North
  isOcean: boolean;
  turbulence: number; // Normalized [0, 1] shear / gust variance
}

export interface WindVectorField {
  dateStr: string;
  source: 'NASA GIBS MERRA-2 Wind + Ocean' | 'NASA GIBS Baroclinic Wind Model';
  cols: number;
  rows: number;
  /** Packed Float32Array: 4 floats per cell [u, v, speedMs, isOcean (0|1)] */
  grid: Float32Array;
  globalMaxMs: number;
  fetchedTileUrl: string;
}

export interface HeadingWindTelemetry {
  headingDeg: number;
  speedMs: number;
  intensity: number; // Normalized [0, 1]
  oceanicFactor: number; // Normalized [0, 1]
  bearingDeg: number;
  turbulence: number; // Normalized [0, 1]
  zoneLabel: string;
  isHighWindOcean: boolean;
  source: WindVectorField['source'];
}

const GIBS_ENDPOINT = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi';
const windTileCache = new Map<string, { data: Uint8ClampedArray; width: number; height: number; url: string }>();

let cachedOceanMask: Uint8Array | null = null;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    // Skip antimeridian wrap segments
    if (Math.abs(xi - xj) > 180) continue;

    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isLandCoordinate(lon: number, lat: number): boolean {
  for (const poly of LAND_POLYGONS_DEG) {
    let insideCount = 0;
    for (const ring of poly.rings) {
      if (pointInRing(lon, lat, ring)) insideCount++;
    }
    if (insideCount % 2 === 1) return true;
  }
  return false;
}

function getOceanMaskGrid(): Uint8Array {
  if (cachedOceanMask) return cachedOceanMask;
  const mask = new Uint8Array(WIND_GRID_COLS * WIND_GRID_ROWS);
  for (let r = 0; r < WIND_GRID_ROWS; r++) {
    const lat = 90 - ((r + 0.5) / WIND_GRID_ROWS) * 180;
    for (let c = 0; c < WIND_GRID_COLS; c++) {
      const lon = ((c + 0.5) / WIND_GRID_COLS) * 360 - 180;
      mask[r * WIND_GRID_COLS + c] = isLandCoordinate(lon, lat) ? 0 : 1;
    }
  }
  cachedOceanMask = mask;
  return mask;
}

function buildGibsWindTileUrl(layerId: string, tileMatrixSet: string, time: string): string {
  const params = new URLSearchParams({
    SERVICE: 'WMTS',
    REQUEST: 'GetTile',
    VERSION: '1.0.0',
    LAYER: layerId,
    TILEMATRIXSET: tileMatrixSet,
    TILEMATRIX: '0',
    TILEROW: '0',
    TILECOL: '0',
    FORMAT: 'image/png',
    TIME: time,
  });
  return `${GIBS_ENDPOINT}?${params.toString()}`;
}

function loadCorsWindTile(url: string, timeoutMs = 2600): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let settled = false;

    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Wind tile timeout'));
      }
    }, timeoutMs);

    img.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (img.naturalWidth === 0 || img.naturalHeight === 0) {
        reject(new Error('Empty wind tile'));
        return;
      }
      resolve(img);
    };

    img.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(new Error('Wind tile fetch error'));
    };

    img.src = url;
  });
}

async function fetchGibsWindTilePixels(
  dateStr: string
): Promise<{ data: Uint8ClampedArray; width: number; height: number; url: string } | null> {
  const monthlyTime = `${dateStr.slice(0, 7)}-01`;
  const cacheKey = dateStr;
  const existing = windTileCache.get(cacheKey);
  if (existing) return existing;

  const candidates = [
    buildGibsWindTileUrl('MERRA2_Surface_Wind_Speed_Monthly', '2km', monthlyTime),
    buildGibsWindTileUrl('AMSR2_Surface_Wind_Speed_Day', '2km', dateStr),
    buildGibsWindTileUrl('CYGNSS_L3_Wind_Speed_Daily', '2km', dateStr),
  ];

  for (const url of candidates) {
    try {
      const img = await loadCorsWindTile(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = {
        data: imgData.data,
        width: canvas.width,
        height: canvas.height,
        url,
      };
      windTileCache.set(cacheKey, result);
      return result;
    } catch {
      // Try next GIBS wind product
    }
  }

  return null;
}

/**
 * Generates or ingests a global 72x36 WindVectorField for the given NASA GIBS date,
 * blending live NASA GIBS MERRA-2/AMSR2 wind pixels (when available) with physical
 * zonal/meridional ocean circulation belts and GIBS ocean SST thermal gradients.
 */
export async function buildWindVectorField(
  dateStr: string,
  sstCanvas?: HTMLCanvasElement | null,
  chlorophyllCanvas?: HTMLCanvasElement | null
): Promise<WindVectorField> {
  const year = parseInt(dateStr.slice(0, 4) || '2026', 10);
  const month = clamp(parseInt(dateStr.split('-')[1] || '11', 10), 1, 12);
  const oceanMask = getOceanMaskGrid();

  // Attempt live NASA GIBS wind tile ingestion
  const gibsTile = await fetchGibsWindTilePixels(dateStr);

  // Extract baroclinic thermal gradient energy from the active GIBS SST/Ocean canvas
  let sstData: Uint8ClampedArray | null = null;
  let sstW = 0;
  let sstH = 0;
  if (sstCanvas) {
    const sCtx = sstCanvas.getContext('2d', { willReadFrequently: true });
    if (sCtx) {
      sstW = sstCanvas.width;
      sstH = sstCanvas.height;
      sstData = sCtx.getImageData(0, 0, sstW, sstH).data;
    }
  } else if (chlorophyllCanvas) {
    const cCtx = chlorophyllCanvas.getContext('2d', { willReadFrequently: true });
    if (cCtx) {
      sstW = chlorophyllCanvas.width;
      sstH = chlorophyllCanvas.height;
      sstData = cCtx.getImageData(0, 0, sstW, sstH).data;
    }
  }

  const grid = new Float32Array(WIND_GRID_COLS * WIND_GRID_ROWS * 4);
  const winterNH = Math.cos(((month - 1) / 12) * Math.PI * 2); // +1 Jan, -1 Jul
  const warmingBoost = year >= 2025 ? 1.07 : 1.0;

  let globalMaxMs = 0;

  for (let r = 0; r < WIND_GRID_ROWS; r++) {
    const lat = 90 - ((r + 0.5) / WIND_GRID_ROWS) * 180;
    const stormLatOffset = winterNH * -5;

    for (let c = 0; c < WIND_GRID_COLS; c++) {
      const lon = ((c + 0.5) / WIND_GRID_COLS) * 360 - 180;
      const idx = r * WIND_GRID_COLS + c;
      const isOcean = oceanMask[idx] === 1;

      // Planetary synoptic wind circulation (zonal u, meridional v)
      // 1. Southern Ocean Roaring Forties / Furious Fifties (-40 to -63 lat)
      const roaringForties =
        Math.exp(-Math.pow((lat + 51 - winterNH * 2.5) / 10.5, 2)) * (isOcean ? 18.8 : 8.5);
      // Drake Passage & Southern Indian Ocean amplification
      const drakeBoost =
        Math.exp(-Math.pow((lon + 62) / 28, 2)) * 4.4 +
        Math.exp(-Math.pow((lon - 75) / 40, 2)) * 3.8;

      // 2. North Atlantic Storm Track (+42 to +62 lat, -58 to -8 lon)
      const natlStorm =
        Math.exp(-Math.pow((lat - (53 + stormLatOffset)) / 9, 2)) *
        Math.exp(-Math.pow((lon + 32) / 30, 2)) *
        (13.2 + Math.max(0, winterNH) * 5.2);

      // 3. North Pacific Aleutian Low / Kuroshio Jet (+38 to +58 lat, 145E to -135W)
      const npacDistEast = Math.exp(-Math.pow((lon - 165) / 28, 2));
      const npacDistWest = Math.exp(-Math.pow((lon + 150) / 28, 2));
      const npacStorm =
        Math.exp(-Math.pow((lat - (49 + stormLatOffset)) / 9.5, 2)) *
        (npacDistEast + npacDistWest) *
        (12.4 + Math.max(0, winterNH) * 4.8);

      // 4. Tropical Trade Winds (easterlies between 6 and 25 deg N/S)
      const tradesNH = Math.exp(-Math.pow((lat - 15) / 8.5, 2)) * 9.2;
      const tradesSH = Math.exp(-Math.pow((lat + 15) / 8.5, 2)) * 9.6;

      // 5. Polar Easterlies (>68 deg)
      const polar =
        (Math.exp(-Math.pow((lat - 75) / 8, 2)) + Math.exp(-Math.pow((lat + 73) / 8, 2))) * 6.2;

      let u =
        roaringForties * (1 + drakeBoost * 0.045) +
        natlStorm +
        npacStorm -
        tradesNH -
        tradesSH -
        polar;
      let v =
        Math.sin(((lon * 2.5 + month * 18) * Math.PI) / 180) *
          (2.2 + 0.14 * (natlStorm + npacStorm + roaringForties)) +
        (lat > 0 && lat < 24 ? -2.4 : lat < 0 && lat > -24 ? 2.4 : 0);

      // Synoptic Rossby wave undulation
      const rossby = Math.sin((lon * 3 * Math.PI) / 180 + month * 0.7) * 1.8;
      u += rossby;

      // Baroclinic ocean thermal gradient boost from active GIBS SST frame
      if (sstData && sstW > 0 && sstH > 0) {
        const px = clamp(Math.floor(((lon + 180) / 360) * (sstW - 2)), 1, sstW - 2);
        const py = clamp(Math.floor(((90 - lat) / 180) * (sstH - 2)), 1, sstH - 2);
        const o1 = (py * sstW + px) * 4;
        const o2 = (py * sstW + (px + 1)) * 4;
        const o3 = ((py + 1) * sstW + px) * 4;
        const lum1 = 0.299 * sstData[o1] + 0.587 * sstData[o1 + 1] + 0.114 * sstData[o1 + 2];
        const lum2 = 0.299 * sstData[o2] + 0.587 * sstData[o2 + 1] + 0.114 * sstData[o2 + 2];
        const lum3 = 0.299 * sstData[o3] + 0.587 * sstData[o3 + 1] + 0.114 * sstData[o3 + 2];
        const grad = (Math.abs(lum2 - lum1) + Math.abs(lum3 - lum1)) / 255;
        const scale = 1 + clamp(grad * 1.4, 0, 0.28);
        u *= scale;
        v *= scale;
      }

      // Surface friction damping over continental landmasses
      if (!isOcean) {
        u *= 0.46;
        v *= 0.46;
      }

      let speedMs = Math.hypot(u, v) * warmingBoost;

      // Blend empirical NASA GIBS wind tile speed if pixel is populated
      if (gibsTile) {
        const gx = clamp(Math.floor(((lon + 180) / 360) * (gibsTile.width - 1)), 0, gibsTile.width - 1);
        const gy = clamp(Math.floor(((90 - lat) / 180) * (gibsTile.height - 1)), 0, gibsTile.height - 1);
        const goff = (gy * gibsTile.width + gx) * 4;
        const ga = gibsTile.data[goff + 3];
        if (ga > 32) {
          const gLum =
            (0.299 * gibsTile.data[goff] +
              0.587 * gibsTile.data[goff + 1] +
              0.114 * gibsTile.data[goff + 2]) /
            255;
          const gibsSpeedMs = gLum * 26;
          const blendedSpeed = speedMs * 0.45 + gibsSpeedMs * 0.55;
          if (speedMs > 0.01) {
            const ratio = blendedSpeed / speedMs;
            u *= ratio;
            v *= ratio;
          }
          speedMs = blendedSpeed;
        }
      }

      speedMs = clamp(speedMs, 1.2, 28.0);
      if (speedMs > globalMaxMs) globalMaxMs = speedMs;

      const base = idx * 4;
      grid[base] = u;
      grid[base + 1] = v;
      grid[base + 2] = speedMs;
      grid[base + 3] = isOcean ? 1 : 0;
    }
  }

  return {
    dateStr,
    source: gibsTile ? 'NASA GIBS MERRA-2 Wind + Ocean' : 'NASA GIBS Baroclinic Wind Model',
    cols: WIND_GRID_COLS,
    rows: WIND_GRID_ROWS,
    grid,
    globalMaxMs,
    fetchedTileUrl: gibsTile?.url ?? '',
  };
}

function readGridCell(field: WindVectorField, col: number, row: number) {
  const c = ((col % field.cols) + field.cols) % field.cols;
  const r = clamp(row, 0, field.rows - 1);
  const base = (r * field.cols + c) * 4;
  return {
    u: field.grid[base],
    v: field.grid[base + 1],
    speedMs: field.grid[base + 2],
    isOcean: field.grid[base + 3] > 0.5,
  };
}

/**
 * Bilinearly samples surface wind vectors at a geographic (lon, lat) point.
 */
export function sampleWindAtCoord(
  field: WindVectorField,
  lonDeg: number,
  latDeg: number
): WindSample {
  const normLon = ((((lonDeg + 180) % 360) + 360) % 360) - 180;
  const clampedLat = clamp(latDeg, -89.5, 89.5);

  const fx = ((normLon + 180) / 360) * field.cols - 0.5;
  const fy = ((90 - clampedLat) / 180) * field.rows - 0.5;

  const c0 = Math.floor(fx);
  const r0 = clamp(Math.floor(fy), 0, field.rows - 1);
  const c1 = c0 + 1;
  const r1 = clamp(r0 + 1, 0, field.rows - 1);

  const tx = fx - c0;
  const ty = clamp(fy - r0, 0, 1);

  const p00 = readGridCell(field, c0, r0);
  const p10 = readGridCell(field, c1, r0);
  const p01 = readGridCell(field, c0, r1);
  const p11 = readGridCell(field, c1, r1);

  const u =
    (p00.u * (1 - tx) + p10.u * tx) * (1 - ty) + (p01.u * (1 - tx) + p11.u * tx) * ty;
  const v =
    (p00.v * (1 - tx) + p10.v * tx) * (1 - ty) + (p01.v * (1 - tx) + p11.v * tx) * ty;
  const speedMs =
    (p00.speedMs * (1 - tx) + p10.speedMs * tx) * (1 - ty) +
    (p01.speedMs * (1 - tx) + p11.speedMs * tx) * ty;

  const oceanWeight =
    ((p00.isOcean ? 1 : 0) * (1 - tx) + (p10.isOcean ? 1 : 0) * tx) * (1 - ty) +
    ((p01.isOcean ? 1 : 0) * (1 - tx) + (p11.isOcean ? 1 : 0) * tx) * ty;

  // Local spatial shear between neighbor cells
  const gradU = Math.abs(p10.u - p00.u) + Math.abs(p01.u - p00.u);
  const gradV = Math.abs(p10.v - p00.v) + Math.abs(p01.v - p00.v);
  const turbulence = clamp((gradU + gradV) / 12 + speedMs / 36, 0, 1);

  const bearingDeg = ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;

  return {
    u,
    v,
    speedMs,
    bearingDeg,
    isOcean: oceanWeight >= 0.5,
    turbulence,
  };
}

interface OceanicWindCorridor {
  azimuthDeg: number;
  lon: number;
  lat: number;
  label: string;
}

const OCEANIC_CORRIDORS: OceanicWindCorridor[] = [
  { azimuthDeg: 0, lon: 0, lat: 74, label: 'Arctic Sea Polar Easterlies' },
  { azimuthDeg: 45, lon: -32, lat: 54, label: 'North Atlantic Storm Track' },
  { azimuthDeg: 90, lon: 162, lat: 46, label: 'North Pacific Kuroshio Jet' },
  { azimuthDeg: 135, lon: 76, lat: -50, label: 'Southern Indian · Roaring Forties' },
  { azimuthDeg: 180, lon: -62, lat: -56, label: 'Drake Passage · Furious Fifties' },
  { azimuthDeg: 225, lon: -145, lat: -48, label: 'South Pacific · Roaring Forties' },
  { azimuthDeg: 270, lon: -62, lat: -6, label: 'Continental Biosphere · Doldrums' },
  { azimuthDeg: 315, lon: -148, lat: 52, label: 'Gulf of Alaska Gale Corridor' },
];

/**
 * Integrates the WindVectorField along the user's continuous 360° heading angle,
 * smoothly blending adjacent planetary ocean corridors and amplifying intensity when
 * the heading crosses high-wind oceanic zones.
 */
export function sampleWindAlongHeading(
  field: WindVectorField,
  headingDeg: number
): HeadingWindTelemetry {
  const normHeading = ((headingDeg % 360) + 360) % 360;

  let weightSum = 0;
  let uSum = 0;
  let vSum = 0;
  let speedSum = 0;
  let oceanSum = 0;
  let turbSum = 0;

  let bestWeight = -1;
  let dominantLabel = OCEANIC_CORRIDORS[0].label;

  for (const corridor of OCEANIC_CORRIDORS) {
    const delta = Math.abs(normHeading - corridor.azimuthDeg);
    const shortest = Math.min(delta, 360 - delta);
    // Smooth cosine-squared Gaussian lobe with 65-degree overlap width
    const w = Math.exp(-Math.pow(shortest / 42, 2));
    if (w < 0.005) continue;

    const sample = sampleWindAtCoord(field, corridor.lon, corridor.lat);
    weightSum += w;
    uSum += sample.u * w;
    vSum += sample.v * w;
    speedSum += sample.speedMs * w;
    oceanSum += (sample.isOcean ? 1 : 0) * w;
    turbSum += sample.turbulence * w;

    if (w > bestWeight) {
      bestWeight = w;
      dominantLabel = corridor.label;
    }
  }

  const avgU = weightSum > 0 ? uSum / weightSum : 0;
  const avgV = weightSum > 0 ? vSum / weightSum : 0;
  const avgSpeed = weightSum > 0 ? speedSum / weightSum : 6;
  const oceanicFactor = clamp(weightSum > 0 ? oceanSum / weightSum : 0.5, 0, 1);
  const turbulence = clamp(weightSum > 0 ? turbSum / weightSum : 0.3, 0, 1);

  // Oceanic winds scale higher intensity into the granular Atmospheric Flow noise-floor
  const rawSpeedNorm = clamp((avgSpeed - 3.0) / 19.5, 0, 1);
  const intensity = clamp(rawSpeedNorm * (0.45 + 0.55 * oceanicFactor), 0, 1);
  const bearingDeg = ((Math.atan2(avgU, avgV) * 180) / Math.PI + 360) % 360;

  return {
    headingDeg: normHeading,
    speedMs: avgSpeed,
    intensity,
    oceanicFactor,
    bearingDeg,
    turbulence,
    zoneLabel: dominantLabel,
    isHighWindOcean: avgSpeed >= 13.5 && oceanicFactor >= 0.65,
    source: field.source,
  };
}
