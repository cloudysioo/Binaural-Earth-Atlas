import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import countries50m from 'world-atlas/countries-50m.json';

type WorldTopology = Topology<{
  countries: GeometryCollection;
  land: GeometryCollection;
}>;

const topology = countries50m as unknown as WorldTopology;
const DEG_TO_RAD = Math.PI / 180;

export type LonLatRing = Array<[number, number]>;
export interface GeoPolygonRings {
  rings: LonLatRing[];
}

// 1. Land polygons in degrees for fast 1024x512 canvas filling & clipping
const landGeo = feature(topology, topology.objects.land);
export const LAND_POLYGONS_DEG: GeoPolygonRings[] = [];

const collectPolygons = (geom: { type: string; coordinates?: unknown; geometries?: unknown[] } | null | undefined) => {
  if (!geom) return;
  if (geom.type === 'Polygon') {
    const coords = (geom as { coordinates: LonLatRing[] }).coordinates;
    LAND_POLYGONS_DEG.push({ rings: coords });
  } else if (geom.type === 'MultiPolygon') {
    const polys = (geom as { coordinates: LonLatRing[][] }).coordinates;
    for (const rings of polys) {
      LAND_POLYGONS_DEG.push({ rings });
    }
  } else if (geom.type === 'GeometryCollection') {
    const geoms = (geom as { geometries: Array<{ type: string; coordinates?: unknown }> }).geometries;
    for (const g of geoms) collectPolygons(g);
  }
};

for (const f of landGeo.features) {
  collectPolygons(f.geometry as { type: string; coordinates?: unknown; geometries?: unknown[] });
}

// 2. Pack MultiLineString coordinates into compact Float32Arrays in radians [lonRad, latRad, ...]
function packMultiLineRadians(lines: number[][][]): Float32Array[] {
  const packed: Float32Array[] = [];
  for (const line of lines) {
    if (line.length < 2) continue;
    const arr = new Float32Array(line.length * 2);
    for (let i = 0; i < line.length; i++) {
      arr[i * 2] = line[i][0] * DEG_TO_RAD;
      arr[i * 2 + 1] = line[i][1] * DEG_TO_RAD;
    }
    packed.push(arr);
  }
  return packed;
}

const coastlineMesh = mesh(topology, topology.objects.land);
const borderMesh = mesh(topology, topology.objects.countries, (a, b) => a !== b);

export const COASTLINE_LINES_RAD: Float32Array[] = packMultiLineRadians(coastlineMesh.coordinates);
export const COUNTRY_BORDERS_RAD: Float32Array[] = packMultiLineRadians(borderMesh.coordinates);

/**
 * Helper to draw detailed Natural Earth 50m land polygons on a Plate Carrée canvas.
 */
export function drawDetailedLandPolygons(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  fillStyle: string,
  strokeStyle?: string
): void {
  ctx.fillStyle = fillStyle;
  for (const poly of LAND_POLYGONS_DEG) {
    ctx.beginPath();
    for (const ring of poly.rings) {
      for (let i = 0; i < ring.length; i++) {
        const [lon, lat] = ring[i];
        const x = ((lon + 180) / 360) * width;
        const y = ((90 - lat) / 180) * height;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          const prevLon = ring[i - 1][0];
          if (Math.abs(lon - prevLon) > 180) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
      }
      ctx.closePath();
    }
    ctx.fill('evenodd');
    if (strokeStyle) {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = 0.85;
      ctx.stroke();
    }
  }
}

/**
 * Helper to stroke packed radian lines onto a Plate Carrée rectangle.
 */
export function strokePackedLinesPlate(
  ctx: CanvasRenderingContext2D,
  lines: Float32Array[],
  rectX: number,
  rectY: number,
  rectW: number,
  rectH: number,
  strokeStyle: string,
  lineWidth: number
): void {
  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();

  const twoPi = Math.PI * 2;
  const halfPi = Math.PI / 2;

  for (let l = 0; l < lines.length; l++) {
    const arr = lines[l];
    let prevLon = 0;
    for (let i = 0; i < arr.length; i += 2) {
      const lon = arr[i];
      const lat = arr[i + 1];
      const x = rectX + ((lon + Math.PI) / twoPi) * rectW;
      const y = rectY + ((halfPi - lat) / Math.PI) * rectH;

      if (i === 0 || Math.abs(lon - prevLon) > Math.PI) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      prevLon = lon;
    }
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Helper to stroke packed radian lines onto an Orthographic 3D sphere with clean horizon clipping.
 */
export function strokePackedLinesOrthographic(
  ctx: CanvasRenderingContext2D,
  lines: Float32Array[],
  phi0: number,
  lam0: number,
  cx: number,
  cy: number,
  R: number,
  strokeStyle: string,
  lineWidth: number
): void {
  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();

  const sinPhi0 = Math.sin(phi0);
  const cosPhi0 = Math.cos(phi0);

  for (let l = 0; l < lines.length; l++) {
    const arr = lines[l];
    let prevVisible = false;
    let prevX = 0;
    let prevY = 0;
    let prevCosC = 0;

    for (let i = 0; i < arr.length; i += 2) {
      const lon = arr[i];
      const lat = arr[i + 1];
      const sinLat = Math.sin(lat);
      const cosLat = Math.cos(lat);
      const dLon = lon - lam0;
      const cosDLon = Math.cos(dLon);
      const cosC = sinPhi0 * sinLat + cosPhi0 * cosLat * cosDLon;
      const px = cx + R * cosLat * Math.sin(dLon);
      const py = cy - R * (cosPhi0 * sinLat - sinPhi0 * cosLat * cosDLon);
      const visible = cosC >= 0;

      if (i === 0) {
        if (visible) ctx.moveTo(px, py);
      } else if (visible && prevVisible) {
        ctx.lineTo(px, py);
      } else if (visible && !prevVisible) {
        // Interpolate horizon intersection where cosC crosses 0
        const denom = cosC - prevCosC;
        const t = Math.abs(denom) > 1e-6 ? -prevCosC / denom : 0.5;
        const hx = prevX + (px - prevX) * t;
        const hy = prevY + (py - prevY) * t;
        // Clamp horizon point strictly onto circle limb R
        const dx = hx - cx;
        const dy = hy - cy;
        const len = Math.hypot(dx, dy) || 1;
        ctx.moveTo(cx + (dx / len) * R, cy + (dy / len) * R);
        ctx.lineTo(px, py);
      } else if (!visible && prevVisible) {
        const denom = prevCosC - cosC;
        const t = Math.abs(denom) > 1e-6 ? prevCosC / denom : 0.5;
        const hx = prevX + (px - prevX) * t;
        const hy = prevY + (py - prevY) * t;
        const dx = hx - cx;
        const dy = hy - cy;
        const len = Math.hypot(dx, dy) || 1;
        ctx.lineTo(cx + (dx / len) * R, cy + (dy / len) * R);
      }

      prevVisible = visible;
      prevX = px;
      prevY = py;
      prevCosC = cosC;
    }
  }

  ctx.stroke();
  ctx.restore();
}
