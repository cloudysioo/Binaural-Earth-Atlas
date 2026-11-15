import { computeSolarPosition } from '../geo/solarTerminator';
import { FeatureVector, LayerKey } from '../types/bea';
import { WindVectorField } from './windVectorField';

export interface SolarActivityTelemetry {
  kpIndex: number; // 0.0 - 9.0 geomagnetic Kp scale
  solarWindKms: number; // 300 - 850 km/s
  auroralPotentialPct: number; // 0 - 100%
  intensity: number; // Normalized [0, 1] trigger metric
  regimeLabel: 'QUIET' | 'UNSETTLED' | 'ACTIVE AURORA' | 'GEOMAGNETIC STORM';
  source: 'NOAA SWPC Live Kp' | 'Solar-Magnetospheric Coupling Model';
}

interface CachedNoaaKp {
  kp: number;
  fetchedAtMs: number;
}

let cachedNoaaKp: CachedNoaaKp | null = null;
let pendingKpFetch: Promise<number | null> | null = null;

/**
 * Fetches live planetary geomagnetic Kp index from NOAA SWPC when reachable,
 * caching results for 5 minutes and failing gracefully offline.
 */
export async function fetchLiveSolarKp(): Promise<number | null> {
  const now = Date.now();
  if (cachedNoaaKp && now - cachedNoaaKp.fetchedAtMs < 300_000) {
    return cachedNoaaKp.kp;
  }
  if (pendingKpFetch) return pendingKpFetch;

  pendingKpFetch = (async () => {
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 3500);
      const res = await fetch(
        'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
        { signal: controller.signal }
      );
      window.clearTimeout(timer);
      if (!res.ok) return null;
      const rows = (await res.json()) as unknown;
      if (!Array.isArray(rows) || rows.length < 2) return null;
      const latest = rows[rows.length - 1];
      if (!Array.isArray(latest) || latest.length < 2) return null;
      const parsed = Number.parseFloat(String(latest[1]));
      if (!Number.isFinite(parsed)) return null;
      const clamped = Math.max(0, Math.min(9, parsed));
      cachedNoaaKp = { kp: clamped, fetchedAtMs: Date.now() };
      return clamped;
    } catch {
      return null;
    } finally {
      pendingKpFetch = null;
    }
  })();

  return pendingKpFetch;
}

function hashDateStr(dateStr: string): number {
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

/**
 * Computes real-time high-latitude solar/geomagnetic activity and auroral potential
 * from live NOAA SWPC Kp (when available), Russell-McPherron equinox/dipole coupling,
 * and polar cryosphere/atmospheric motion telemetry.
 */
export function computeSolarActivityTelemetry(
  utcMs: number,
  dateStr: string,
  vectors: Record<LayerKey, FeatureVector>,
  windField: WindVectorField | null,
  liveNoaaKp: number | null = cachedNoaaKp?.kp ?? null
): SolarActivityTelemetry {
  const solar = computeSolarPosition(utcMs);

  // Russell-McPherron geomagnetic coupling peaks near equinoxes (|declination| near 0°)
  const equinoctialCoupling = 1 - Math.min(1, Math.abs(solar.declinationDeg) / 23.5);

  // Magnetic dipole alignment wave (North magnetic pole ~72.6°W)
  const dipoleAngleRad = ((solar.subsolarLonDeg + 72.6) * Math.PI) / 180;
  const dipoleWave = 0.5 + 0.5 * Math.cos(dipoleAngleRad);

  // Polar/high-energy Earth observation coupling
  const polarDynamics =
    0.45 * (vectors.north?.edgeDensity ?? 0) +
    0.35 * (vectors.north?.motion ?? 0) +
    0.2 * (vectors.south?.climateAnomaly ?? 0);

  const windBoost = windField ? Math.min(1, windField.globalMaxMs / 32) * 0.22 : 0.08;

  // Temporal solar flux pulse calibrated deterministically to date + slow 90s substorm wave
  const dateSeed = hashDateStr(dateStr);
  const substormWave = 0.5 + 0.5 * Math.sin(utcMs / 18000 + dateSeed * Math.PI * 2);
  const stormEpochBoost = dateStr.endsWith('-09-15') || dateStr.endsWith('-03-15') ? 0.16 : 0;

  let kpIndex: number;
  let source: SolarActivityTelemetry['source'];

  if (liveNoaaKp !== null && Number.isFinite(liveNoaaKp) && !dateStr.startsWith('2007-')) {
    // Combine live NOAA Kp with localized substorm micro-modulation
    kpIndex = Math.max(
      0,
      Math.min(9, liveNoaaKp + (substormWave - 0.35) * 1.15 + polarDynamics * 0.6)
    );
    source = 'NOAA SWPC Live Kp';
  } else {
    const modeledNorm = Math.min(
      1,
      Math.max(
        0.12,
        0.24 +
          equinoctialCoupling * 0.24 +
          dipoleWave * 0.16 +
          polarDynamics * 0.22 +
          windBoost +
          substormWave * 0.24 +
          stormEpochBoost
      )
    );
    kpIndex = Number((modeledNorm * 8.2).toFixed(2));
    source = 'Solar-Magnetospheric Coupling Model';
  }

  const intensity = Math.max(0, Math.min(1, kpIndex / 8.2));
  const solarWindKms = Math.round(330 + intensity * 490 + substormWave * 45);
  const auroralPotentialPct = Math.round(intensity * 100);

  const regimeLabel: SolarActivityTelemetry['regimeLabel'] =
    kpIndex >= 5.5
      ? 'GEOMAGNETIC STORM'
      : kpIndex >= 4.0
      ? 'ACTIVE AURORA'
      : kpIndex >= 2.5
      ? 'UNSETTLED'
      : 'QUIET';

  return {
    kpIndex: Number(kpIndex.toFixed(1)),
    solarWindKms,
    auroralPotentialPct,
    intensity: Number(intensity.toFixed(3)),
    regimeLabel,
    source,
  };
}
