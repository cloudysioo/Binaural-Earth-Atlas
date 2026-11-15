import { sampleWindAtCoord, WindVectorField } from '../analysis/windVectorField';

export interface WindParticle {
  lon: number;
  lat: number;
  age: number;
  maxAge: number;
}

export interface WindFittedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindSpeedLegendStop {
  label: string;
  color: string;
  nightColor: string;
}

const DEG2RAD = Math.PI / 180;
export const WIND_PARTICLE_COUNT = 380;

export const WIND_SPEED_LEGEND_STOPS: WindSpeedLegendStop[] = [
  { label: '0–6 m/s', color: '#94A3B8', nightColor: '#7F1D1D' },
  { label: '6–14 m/s', color: '#5EEAD4', nightColor: '#B91C1C' },
  { label: '14–22 m/s', color: '#38BDF8', nightColor: '#DC2626' },
  { label: '22+ m/s', color: '#F59E0B', nightColor: '#FF3B30' },
];

function spawnWindParticle(staggerAge: boolean): WindParticle {
  // Slight cosine weighting toward populated/oceanic latitudes while keeping polar bands represented
  const u = Math.random() * 2 - 1;
  const lat = Math.max(-80, Math.min(80, Math.asin(u * 0.985) * (180 / Math.PI)));
  const lon = Math.random() * 360 - 180;
  const maxAge = 55 + Math.random() * 75;
  return {
    lon,
    lat,
    age: staggerAge ? Math.random() * maxAge : 0,
    maxAge,
  };
}

export function createWindParticlePool(count = WIND_PARTICLE_COUNT): WindParticle[] {
  const pool: WindParticle[] = new Array(count);
  for (let i = 0; i < count; i++) {
    pool[i] = spawnWindParticle(true);
  }
  return pool;
}

function projectGlobePoint(
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
  if (cosC < 0.03) return null;

  return {
    x: cx + R * cosLat * Math.sin(dLon),
    y: cy - R * (cosPhi0 * sinLat - sinPhi0 * cosLat * Math.cos(dLon)),
    cosC,
  };
}

function getWindStrokeStyle(
  speedMs: number,
  alpha: number,
  nightMode: boolean
): { stroke: string; lineWidth: number } {
  const a = Math.max(0.05, Math.min(0.95, alpha)).toFixed(3);
  if (nightMode) {
    if (speedMs >= 22) return { stroke: `rgba(255, 59, 48, ${a})`, lineWidth: 1.55 };
    if (speedMs >= 14) return { stroke: `rgba(220, 38, 38, ${a})`, lineWidth: 1.35 };
    if (speedMs >= 6) return { stroke: `rgba(185, 28, 28, ${a})`, lineWidth: 1.1 };
    return { stroke: `rgba(127, 29, 29, ${a})`, lineWidth: 0.9 };
  }

  if (speedMs >= 22) return { stroke: `rgba(245, 158, 11, ${a})`, lineWidth: 1.85 };
  if (speedMs >= 14) return { stroke: `rgba(56, 189, 248, ${a})`, lineWidth: 1.5 };
  if (speedMs >= 6) return { stroke: `rgba(94, 234, 212, ${a})`, lineWidth: 1.25 };
  return { stroke: `rgba(148, 163, 184, ${a})`, lineWidth: 0.95 };
}

export interface StepWindOverlayParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dtSec: number;
  projection: 'globe' | 'plate';
  windField: WindVectorField;
  particles: WindParticle[];
  globeCenter: { lat: number; lon: number };
  fittedRect: WindFittedRect;
  nightMode: boolean;
}

/**
 * Advances wind streamline particles and renders speed-coded animated velocity trails
 * onto a transparent overlay canvas aligned with either the 3D Orthographic Globe or
 * the 2D EPSG:4326 Plate Carree map.
 */
export function stepAndDrawWindOverlay({
  ctx,
  width,
  height,
  dtSec,
  projection,
  windField,
  particles,
  globeCenter,
  fittedRect,
  nightMode,
}: StepWindOverlayParams): void {
  if (width <= 0 || height <= 0) return;

  // Fade previous frame's trails smoothly without touching underlying satellite pixels
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = nightMode ? 'rgba(0, 0, 0, 0.16)' : 'rgba(0, 0, 0, 0.13)';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  const cx = width / 2;
  const cy = height / 2;
  const R = Math.min(width, height) * 0.43;
  const phi0 = globeCenter.lat * DEG2RAD;
  const lam0 = globeCenter.lon * DEG2RAD;

  ctx.save();
  ctx.beginPath();
  if (projection === 'globe') {
    ctx.arc(cx, cy, Math.max(4, R - 1), 0, Math.PI * 2);
  } else {
    ctx.rect(fittedRect.x, fittedRect.y, fittedRect.w, fittedRect.h);
  }
  ctx.clip();

  ctx.globalCompositeOperation = nightMode ? 'source-over' : 'lighter';
  ctx.lineCap = 'square';

  const dtNorm = Math.min(0.05, Math.max(0.008, dtSec));
  const degScale = dtNorm * 0.34;
  const ageStep = dtNorm * 60;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const sample = sampleWindAtCoord(windField, p.lon, p.lat);

    const cosLat = Math.max(0.28, Math.cos(p.lat * DEG2RAD));
    const nextLonRaw = p.lon + (sample.u * degScale) / cosLat;
    const nextLat = p.lat + sample.v * degScale;

    p.age += ageStep;

    if (p.age >= p.maxAge || nextLat > 81 || nextLat < -81) {
      particles[i] = spawnWindParticle(false);
      continue;
    }

    // Wrap across the antimeridian cleanly without drawing a full-width streak
    if (nextLonRaw > 180 || nextLonRaw < -180) {
      p.lon = ((((nextLonRaw + 180) % 360) + 360) % 360) - 180;
      p.lat = nextLat;
      continue;
    }

    const lifeRatio = p.age / p.maxAge;
    const lifeFade = Math.sin(lifeRatio * Math.PI);
    const oceanWeight = sample.isOcean ? 1.0 : 0.72;
    const speedAlpha = 0.28 + Math.min(1, sample.speedMs / 24) * 0.65;

    if (projection === 'plate') {
      const x0 = fittedRect.x + ((p.lon + 180) / 360) * fittedRect.w;
      const y0 = fittedRect.y + ((90 - p.lat) / 180) * fittedRect.h;
      const x1 = fittedRect.x + ((nextLonRaw + 180) / 360) * fittedRect.w;
      const y1 = fittedRect.y + ((90 - nextLat) / 180) * fittedRect.h;

      // Ensure short realistic step (if vector velocity is near-zero, nudge pixel slightly)
      const dx = x1 - x0;
      const dy = y1 - y0;
      if (Math.hypot(dx, dy) > 0.04) {
        const baseAlpha = lifeFade * speedAlpha * oceanWeight * (nightMode ? 0.64 : 0.84);
        const style = getWindStrokeStyle(sample.speedMs, baseAlpha, nightMode);
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = style.lineWidth;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();

        if (sample.speedMs >= 10) {
          ctx.fillStyle = style.stroke;
          ctx.fillRect(x1 - 0.75, y1 - 0.75, 1.5, 1.5);
        }
      }
    } else {
      const pt0 = projectGlobePoint(p.lat, p.lon, phi0, lam0, cx, cy, R);
      const pt1 = projectGlobePoint(nextLat, nextLonRaw, phi0, lam0, cx, cy, R);

      if (pt0 && pt1) {
        const segLen = Math.hypot(pt1.x - pt0.x, pt1.y - pt0.y);
        if (segLen > 0.04 && segLen < R * 0.25) {
          const limbFade = Math.min(1, pt1.cosC * 2.2);
          const baseAlpha =
            lifeFade * limbFade * speedAlpha * oceanWeight * (nightMode ? 0.65 : 0.88);
          const style = getWindStrokeStyle(sample.speedMs, baseAlpha, nightMode);
          ctx.strokeStyle = style.stroke;
          ctx.lineWidth = style.lineWidth;
          ctx.beginPath();
          ctx.moveTo(pt0.x, pt0.y);
          ctx.lineTo(pt1.x, pt1.y);
          ctx.stroke();

          if (sample.speedMs >= 10) {
            ctx.fillStyle = style.stroke;
            ctx.fillRect(pt1.x - 0.75, pt1.y - 0.75, 1.5, 1.5);
          }
        }
      }
    }

    p.lon = nextLonRaw;
    p.lat = nextLat;
  }

  ctx.restore();
}
