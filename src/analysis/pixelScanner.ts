import {
  drawDetailedLandPolygons,
  LAND_POLYGONS_DEG,
} from '../geo/worldBorders';
import { LayerKey, NASA_GIBS_LAYERS } from '../types/bea';

export const ANALYSIS_WIDTH = 1024;
export const ANALYSIS_HEIGHT = 512;

const GIBS_TILE_MATRIX = '1';
const GIBS_TILE_SIZE = 512;
const GIBS_MATRIX_COLS = 3;
const GIBS_MATRIX_ROWS = 2;
const GIBS_EARTH_CROP_W = 1280;
const GIBS_EARTH_CROP_H = 640;

export interface FrameLoadResult {
  canvas: HTMLCanvasElement;
  source: 'NASA GIBS WMTS' | 'Procedural Earth Model';
  url: string;
}

const GIBS_ENDPOINT = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi';

const frameCache = new Map<
  string,
  { imageData: ImageData; source: FrameLoadResult['source']; url: string }
>();

function resolveLayerAndTime(
  layerKey: LayerKey,
  dateString: string,
  useFallback: boolean
): { layerId: string; tileMatrixSet: string; format: string; time: string } {
  const layer = NASA_GIBS_LAYERS[layerKey];
  const year = parseInt(dateString.slice(0, 4), 10);
  const month = parseInt(dateString.slice(5, 7), 10);

  if (layerKey === 'west') {
    const preferMonthly = year < 2025 || (year === 2025 && month === 1);
    const pickMonthly = useFallback ? !preferMonthly : preferMonthly;
    if (pickMonthly) {
      return {
        layerId: 'MODIS_Terra_L3_NDVI_Monthly',
        tileMatrixSet: '1km',
        format: 'image/png',
        time: `${dateString.slice(0, 7)}-01`,
      };
    }
    return {
      layerId: 'MODIS_Terra_NDVI_8Day',
      tileMatrixSet: '250m',
      format: 'image/png',
      time: dateString,
    };
  }

  if (useFallback) {
    return {
      layerId: layer.fallbackLayerId,
      tileMatrixSet: layer.fallbackTileMatrixSet,
      format: layer.fallbackLayerId.includes('TrueColor') ? 'image/jpeg' : layer.format,
      time: dateString,
    };
  }

  return {
    layerId: layer.gibsLayerId,
    tileMatrixSet: layer.tileMatrixSet,
    format: layer.format,
    time: dateString,
  };
}

export function getGIBSTileUrl(
  layerKey: LayerKey,
  dateString: string,
  tileCol = 0,
  tileRow = 0,
  useFallback = false
): string {
  const spec = resolveLayerAndTime(layerKey, dateString, useFallback);
  const params = new URLSearchParams({
    SERVICE: 'WMTS',
    REQUEST: 'GetTile',
    VERSION: '1.0.0',
    LAYER: spec.layerId,
    TILEMATRIXSET: spec.tileMatrixSet,
    TILEMATRIX: GIBS_TILE_MATRIX,
    TILEROW: String(tileRow),
    TILECOL: String(tileCol),
    FORMAT: spec.format,
    TIME: spec.time,
  });
  return `${GIBS_ENDPOINT}?${params.toString()}`;
}

function loadCorsImage(url: string, timeoutMs = 4500): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let settled = false;

    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Timeout fetching GIBS tile: ${url}`));
      }
    }, timeoutMs);

    img.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (img.naturalWidth === 0 || img.naturalHeight === 0) {
        reject(new Error('Empty tile image'));
        return;
      }
      resolve(img);
    };

    img.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(new Error(`Network/CORS failure loading GIBS tile`));
    };

    img.src = url;
  });
}

function lonLatToXY(lon: number, lat: number): [number, number] {
  const x = ((lon + 180) / 360) * ANALYSIS_WIDTH;
  const y = ((90 - lat) / 180) * ANALYSIS_HEIGHT;
  return [x, y];
}

function renderBaseGeography(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#071426';
  ctx.fillRect(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
  drawDetailedLandPolygons(ctx, ANALYSIS_WIDTH, ANALYSIS_HEIGHT, '#112136', '#244A6B');
}

export function renderProceduralFrame(
  canvas: HTMLCanvasElement,
  layerKey: LayerKey,
  dateString: string
): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const year = parseInt(dateString.slice(0, 4) || '2026', 10);
  const month = Math.max(1, Math.min(12, parseInt(dateString.split('-')[1] || '1', 10)));
  const modernWarmingOffset = year >= 2025 ? 2.5 : 0;
  const sepMeltFactor = Math.max(0, Math.sin(((month - 3) / 12) * Math.PI * 2));
  const borealSummer = Math.max(0, Math.sin(((month - 3.5) / 12) * Math.PI * 2));

  ctx.fillStyle = '#061224';
  ctx.fillRect(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);

  if (layerKey === 'north') {
    const iceExtentLat = 63 + modernWarmingOffset + sepMeltFactor * 18.5;
    const [, iceBottomY] = lonLatToXY(0, Math.min(86, iceExtentLat));

    ctx.fillStyle = '#4B7FA8';
    ctx.fillRect(0, 0, ANALYSIS_WIDTH, iceBottomY + 14);

    ctx.fillStyle = '#E6F4FA';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(ANALYSIS_WIDTH, 0);
    for (let x = ANALYSIS_WIDTH; x >= 0; x -= 16) {
      const lon = (x / ANALYSIS_WIDTH) * 360 - 180;
      const pacificNotch =
        sepMeltFactor * 38 * Math.exp(-Math.pow((lon + 150) / 48, 2)) +
        sepMeltFactor * 26 * Math.exp(-Math.pow((lon - 140) / 45, 2));
      const wave = Math.sin(lon * 0.14 + month * 0.6) * 6;
      const y = Math.max(10, iceBottomY - pacificNotch + wave);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    const antarcticIceLat = -64 - (1 - borealSummer) * 5;
    const [, antTopY] = lonLatToXY(0, antarcticIceLat);
    ctx.fillStyle = '#CFE8F5';
    ctx.fillRect(0, antTopY, ANALYSIS_WIDTH, ANALYSIS_HEIGHT - antTopY);

    drawDetailedLandPolygons(ctx, ANALYSIS_WIDTH, ANALYSIS_HEIGHT, '#162436', '#2B4C65');
  } else if (layerKey === 'east') {
    const bloomStrength = 0.35 + borealSummer * 0.65;
    const drawGyreBloom = (lon: number, lat: number, rx: number, ry: number, color: string) => {
      const [cx, cy] = lonLatToXY(lon, lat);
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    drawGyreBloom(-35, 54, 95, 28, `rgba(45, 212, 191, ${0.28 + bloomStrength * 0.45})`);
    drawGyreBloom(160, 46, 110, 26, `rgba(56, 189, 248, ${0.25 + bloomStrength * 0.42})`);
    drawGyreBloom(-82, -12, 34, 48, `rgba(94, 234, 212, ${0.42 + (1 - borealSummer) * 0.35})`);
    drawGyreBloom(55, 14, 42, 26, `rgba(34, 211, 238, ${0.32 + borealSummer * 0.35})`);

    ctx.strokeStyle = '#5EEAD4';
    ctx.lineWidth = 2;
    for (let i = 0; i < 18; i++) {
      const phase = (month * 0.45 + i * 0.6) % (Math.PI * 2);
      const startLon = -75 + (i % 6) * 14;
      const startLat = 28 + Math.sin(phase) * 9 + (i % 3) * 4;
      const [x1, y1] = lonLatToXY(startLon, startLat);
      const [x2, y2] = lonLatToXY(startLon + 16, startLat + 6);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    const [, accY] = lonLatToXY(0, -52);
    ctx.fillStyle = 'rgba(14, 165, 233, 0.38)';
    ctx.fillRect(0, accY - 14, ANALYSIS_WIDTH, 28);

    drawDetailedLandPolygons(ctx, ANALYSIS_WIDTH, ANALYSIS_HEIGHT, '#0E1B2E', '#1F6075');
  } else if (layerKey === 'south') {
    const bands = 64;
    const bandH = ANALYSIS_HEIGHT / bands;
    for (let b = 0; b < bands; b++) {
      const lat = 90 - ((b + 0.5) / bands) * 180;
      const seasonalShift = Math.sin(((month - 4) / 12) * Math.PI * 2) * 12;
      const thermalLat = lat - seasonalShift;
      const baseTemp = Math.cos((thermalLat * Math.PI) / 180);
      const normTemp = Math.max(0, Math.min(1, baseTemp + (year >= 2025 ? 0.05 : 0)));

      let r = 10;
      let g = 35;
      let bl = 95;
      if (normTemp > 0.72) {
        const t = (normTemp - 0.72) / 0.28;
        r = Math.round(210 + t * 45);
        g = Math.round(95 - t * 25);
        bl = Math.round(60 - t * 25);
      } else if (normTemp > 0.42) {
        const t = (normTemp - 0.42) / 0.3;
        r = Math.round(35 + t * 175);
        g = Math.round(145 - t * 45);
        bl = Math.round(150 - t * 90);
      } else {
        const t = normTemp / 0.42;
        r = Math.round(10 + t * 25);
        g = Math.round(35 + t * 110);
        bl = Math.round(115 + t * 35);
      }
      ctx.fillStyle = `rgb(${r}, ${g}, ${bl})`;
      ctx.fillRect(0, b * bandH, ANALYSIS_WIDTH, bandH + 1);
    }

    drawDetailedLandPolygons(ctx, ANALYSIS_WIDTH, ANALYSIS_HEIGHT, '#0B1526', '#25425C');
  } else {
    drawDetailedLandPolygons(ctx, ANALYSIS_WIDTH, ANALYSIS_HEIGHT, '#4B4533', '#2B3B4E');

    ctx.save();
    ctx.beginPath();
    for (const poly of LAND_POLYGONS_DEG) {
      for (const ring of poly.rings) {
        for (let i = 0; i < ring.length; i++) {
          const [lon, lat] = ring[i];
          const [x, y] = lonLatToXY(lon, lat);
          if (i === 0 || Math.abs(lon - ring[i - 1][0]) > 180) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
      }
    }
    ctx.clip('evenodd');

    const [, tropTop] = lonLatToXY(0, 14);
    const [, tropBot] = lonLatToXY(0, -16);
    ctx.fillStyle = '#16A34A';
    ctx.fillRect(0, tropTop, ANALYSIS_WIDTH, tropBot - tropTop);

    const nhGreen = 0.25 + borealSummer * 0.75;
    const [, borTop] = lonLatToXY(0, 68);
    const [, borBot] = lonLatToXY(0, 32);
    ctx.fillStyle = `rgba(74, 222, 128, ${0.18 + nhGreen * 0.65})`;
    ctx.fillRect(0, borTop, ANALYSIS_WIDTH, borBot - borTop);

    const shGreen = 0.35 + (1 - borealSummer) * 0.45;
    const [, shTop] = lonLatToXY(0, -18);
    const [, shBot] = lonLatToXY(0, -45);
    ctx.fillStyle = `rgba(34, 197, 94, ${0.22 + shGreen * 0.42})`;
    ctx.fillRect(0, shTop, ANALYSIS_WIDTH, shBot - shTop);

    ctx.restore();
  }
}

async function fetchGibsMosaic(
  layerKey: LayerKey,
  dateString: string,
  useFallback: boolean
): Promise<{ tiles: Array<{ col: number; row: number; img: HTMLImageElement }>; primaryUrl: string }> {
  const primaryUrl = getGIBSTileUrl(layerKey, dateString, 0, 0, useFallback);
  const tileJobs: Array<{ col: number; row: number; promise: Promise<HTMLImageElement> }> = [];

  for (let row = 0; row < GIBS_MATRIX_ROWS; row++) {
    for (let col = 0; col < GIBS_MATRIX_COLS; col++) {
      tileJobs.push({
        col,
        row,
        promise: loadCorsImage(getGIBSTileUrl(layerKey, dateString, col, row, useFallback)),
      });
    }
  }

  const tiles = await Promise.all(
    tileJobs.map(async (job) => ({
      col: job.col,
      row: job.row,
      img: await job.promise,
    }))
  );

  return { tiles, primaryUrl };
}

export async function loadGIBSFrame(
  layerKey: LayerKey,
  dateString: string,
  offscreenCanvas: HTMLCanvasElement
): Promise<FrameLoadResult> {
  const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
  const cacheKey = `${layerKey}:${dateString}`;
  const cached = frameCache.get(cacheKey);
  if (cached && ctx) {
    ctx.putImageData(cached.imageData, 0, 0);
    return {
      canvas: offscreenCanvas,
      source: cached.source,
      url: cached.url,
    };
  }

  let mosaic: { tiles: Array<{ col: number; row: number; img: HTMLImageElement }>; primaryUrl: string } | null =
    null;

  try {
    mosaic = await fetchGibsMosaic(layerKey, dateString, false);
  } catch {
    try {
      mosaic = await fetchGibsMosaic(layerKey, dateString, true);
    } catch {
      mosaic = null;
    }
  }

  if (mosaic && ctx) {
    const stage = document.createElement('canvas');
    stage.width = GIBS_MATRIX_COLS * GIBS_TILE_SIZE;
    stage.height = GIBS_MATRIX_ROWS * GIBS_TILE_SIZE;
    const stageCtx = stage.getContext('2d');

    if (stageCtx) {
      for (const tile of mosaic.tiles) {
        stageCtx.drawImage(
          tile.img,
          tile.col * GIBS_TILE_SIZE,
          tile.row * GIBS_TILE_SIZE,
          GIBS_TILE_SIZE,
          GIBS_TILE_SIZE
        );
      }

      renderBaseGeography(ctx);
      ctx.drawImage(
        stage,
        0,
        0,
        GIBS_EARTH_CROP_W,
        GIBS_EARTH_CROP_H,
        0,
        0,
        ANALYSIS_WIDTH,
        ANALYSIS_HEIGHT
      );

      const imgData = ctx.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      frameCache.set(cacheKey, {
        imageData: imgData,
        source: 'NASA GIBS WMTS',
        url: mosaic.primaryUrl,
      });

      return {
        canvas: offscreenCanvas,
        source: 'NASA GIBS WMTS',
        url: mosaic.primaryUrl,
      };
    }
  }

  renderProceduralFrame(offscreenCanvas, layerKey, dateString);
  if (ctx) {
    const imgData = ctx.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    frameCache.set(cacheKey, {
      imageData: imgData,
      source: 'Procedural Earth Model',
      url: getGIBSTileUrl(layerKey, dateString, 0, 0, false),
    });
  }
  return {
    canvas: offscreenCanvas,
    source: 'Procedural Earth Model',
    url: getGIBSTileUrl(layerKey, dateString, 0, 0, false),
  };
}
