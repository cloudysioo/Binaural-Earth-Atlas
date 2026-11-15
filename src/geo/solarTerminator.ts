import * as d3 from 'd3';

export interface SolarPosition {
  utcMs: number;
  utcTimeStr: string;
  utcDateStr: string;
  subsolarLatDeg: number;
  subsolarLonDeg: number;
  antisolarLatDeg: number;
  antisolarLonDeg: number;
  declinationDeg: number;
  declinationRad: number;
  sinDecl: number;
  cosDecl: number;
  subsolarLonRad: number;
}

export type SolarRegime =
  | 'DAYLIT'
  | 'CIVIL TWILIGHT'
  | 'NAUTICAL TWILIGHT'
  | 'ASTRONOMICAL TWILIGHT'
  | 'NIGHT SHADOW';

export interface SolarPointTelemetry {
  elevationDeg: number;
  cosZenith: number;
  regime: SolarRegime;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function normalizeDeg360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function wrapLonDeg(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function formatCoordLat(latDeg: number): string {
  return `${Math.abs(latDeg).toFixed(1)}°${latDeg >= 0 ? 'N' : 'S'}`;
}

export function formatCoordLon(lonDeg: number): string {
  return `${Math.abs(lonDeg).toFixed(1)}°${lonDeg >= 0 ? 'E' : 'W'}`;
}

/**
 * Computes real-time subsolar latitude/longitude and solar declination from a UTC timestamp
 * using the USNO/NOAA low-precision solar ephemeris (accurate to ~0.01°).
 */
export function computeSolarPosition(utcMs: number): SolarPosition {
  const date = new Date(utcMs);
  const jd = utcMs / 86400000 + 2440587.5;
  const n = jd - 2451545.0; // Days since J2000.0

  const meanLongitudeDeg = normalizeDeg360(280.46 + 0.9856474 * n);
  const meanAnomalyRad = normalizeDeg360(357.528 + 0.9856003 * n) * DEG_TO_RAD;

  const eclipticLonDeg =
    meanLongitudeDeg + 1.915 * Math.sin(meanAnomalyRad) + 0.02 * Math.sin(2 * meanAnomalyRad);
  const eclipticLonRad = eclipticLonDeg * DEG_TO_RAD;

  const obliquityRad = (23.439 - 0.0000004 * n) * DEG_TO_RAD;

  const sinDecl = Math.sin(obliquityRad) * Math.sin(eclipticLonRad);
  const declinationRad = Math.asin(Math.max(-1, Math.min(1, sinDecl)));
  const cosDecl = Math.cos(declinationRad);
  const declinationDeg = declinationRad * RAD_TO_DEG;

  const rightAscensionRad = Math.atan2(
    Math.cos(obliquityRad) * Math.sin(eclipticLonRad),
    Math.cos(eclipticLonRad)
  );
  const rightAscensionDeg = rightAscensionRad * RAD_TO_DEG;

  const gmstDeg = normalizeDeg360(280.46061837 + 360.98564736629 * n);
  const subsolarLonDeg = wrapLonDeg(rightAscensionDeg - gmstDeg);
  const subsolarLatDeg = declinationDeg;

  const antisolarLonDeg = wrapLonDeg(subsolarLonDeg + 180);
  const antisolarLatDeg = -subsolarLatDeg;

  const iso = date.toISOString();

  return {
    utcMs,
    utcTimeStr: `${iso.slice(11, 19)} UTC`,
    utcDateStr: iso.slice(0, 10),
    subsolarLatDeg,
    subsolarLonDeg,
    antisolarLatDeg,
    antisolarLonDeg,
    declinationDeg,
    declinationRad,
    sinDecl,
    cosDecl,
    subsolarLonRad: subsolarLonDeg * DEG_TO_RAD,
  };
}

/**
 * Computes local solar elevation angle and twilight classification at any geographic point.
 */
export function sampleSolarAt(
  solar: SolarPosition,
  lonDeg: number,
  latDeg: number
): SolarPointTelemetry {
  const latRad = latDeg * DEG_TO_RAD;
  const lonRad = lonDeg * DEG_TO_RAD;
  const cosZenith =
    Math.sin(latRad) * solar.sinDecl +
    Math.cos(latRad) * solar.cosDecl * Math.cos(lonRad - solar.subsolarLonRad);
  const clamped = Math.max(-1, Math.min(1, cosZenith));
  const elevationDeg = Math.asin(clamped) * RAD_TO_DEG;

  let regime: SolarRegime = 'NIGHT SHADOW';
  if (elevationDeg >= 0) {
    regime = 'DAYLIT';
  } else if (elevationDeg >= -6) {
    regime = 'CIVIL TWILIGHT';
  } else if (elevationDeg >= -12) {
    regime = 'NAUTICAL TWILIGHT';
  } else if (elevationDeg >= -18) {
    regime = 'ASTRONOMICAL TWILIGHT';
  }

  return {
    elevationDeg,
    cosZenith: clamped,
    regime,
  };
}

/**
 * Computes night-side shadow shading & atmospheric twilight horizon scatter for a surface pixel.
 */
export function shadePixelBySolarCosZ(
  r: number,
  g: number,
  b: number,
  cosZ: number,
  nightMode = false
): [number, number, number] {
  if (cosZ >= 0.06) {
    return [r, g, b];
  }

  // Smoothstep transition across astronomical/civil twilight (-0.22 .. +0.06)
  const t = Math.max(0, Math.min(1, (cosZ + 0.22) / 0.28));
  const daylightWeight = t * t * (3 - 2 * t);
  const nightWeight = 1 - daylightWeight;

  // Nocturnal shadow attenuation preserves coastline and satellite features in muted night tones
  const lumFactor = 0.28 + 0.72 * daylightWeight;
  const tintR = nightMode ? 14 : 10;
  const tintG = nightMode ? 2 : 19;
  const tintB = nightMode ? 3 : 42;
  let sr = r * lumFactor * (1 - 0.32 * nightWeight) + tintR * (0.32 * nightWeight);
  let sg = g * lumFactor * (1 - 0.32 * nightWeight) + tintG * (0.32 * nightWeight);
  let sb = b * lumFactor * (1 - 0.32 * nightWeight) + tintB * (0.32 * nightWeight);

  // Atmospheric horizon scatter along the 0° solar terminator (attenuated in Night Mode to avoid bloom)
  const horizonBand = Math.exp(-Math.pow(cosZ / 0.042, 2));
  if (horizonBand > 0.01) {
    if (nightMode) {
      sr = Math.min(255, sr + 14 * horizonBand);
      sg = Math.min(255, sg + 2 * horizonBand);
    } else {
      sr = Math.min(255, sr + 46 * horizonBand);
      sg = Math.min(255, sg + 24 * horizonBand);
      sb = Math.min(255, sb + 6 * horizonBand);
    }
  }

  return [sr, sg, sb];
}

function drawSubsolarBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  color: string,
  isSun: boolean,
  bgColor = 'rgba(6, 11, 20, 0.85)'
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.4;

  ctx.beginPath();
  ctx.arc(x, y, isSun ? 5 : 4, 0, Math.PI * 2);
  ctx.stroke();

  if (isSun) {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7);
      ctx.lineTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10);
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillStyle = bgColor;
  const textW = ctx.measureText(label).width;
  ctx.fillRect(x + 11, y - 8, textW + 8, 15);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 11, y - 8, textW + 8, 15);
  ctx.fillStyle = color;
  ctx.fillText(label, x + 15, y + 3);
  ctx.restore();
}

/**
 * Renders the dynamic Solar Terminator shadow polygons, twilight boundary, and subsolar markers
 * on the EPSG:4326 Plate Carrée map using D3 spherical geometry.
 */
export function renderSolarTerminatorPlate(
  ctx: CanvasRenderingContext2D,
  solar: SolarPosition,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
  nightMode = false
): void {
  const projection = d3
    .geoEquirectangular()
    .fitExtent([[fx, fy], [fx + fw, fy + fh]], { type: 'Sphere' });
  const pathGen = d3.geoPath(projection, ctx);

  const nightHemisphere = d3
    .geoCircle()
    .center([solar.antisolarLonDeg, solar.antisolarLatDeg])
    .radius(90)
    .precision(2)();

  const civilShadow = d3
    .geoCircle()
    .center([solar.antisolarLonDeg, solar.antisolarLatDeg])
    .radius(84)
    .precision(2)();

  const astronomicalNight = d3
    .geoCircle()
    .center([solar.antisolarLonDeg, solar.antisolarLatDeg])
    .radius(72)
    .precision(2)();

  ctx.save();
  ctx.beginPath();
  ctx.rect(fx, fy, fw, fh);
  ctx.clip();

  // Layered night shadow + twilight penumbra
  ctx.fillStyle = nightMode ? 'rgba(10, 1, 3, 0.30)' : 'rgba(6, 11, 24, 0.24)';
  ctx.beginPath();
  pathGen(nightHemisphere);
  ctx.fill();

  ctx.fillStyle = nightMode ? 'rgba(8, 1, 2, 0.30)' : 'rgba(6, 11, 24, 0.26)';
  ctx.beginPath();
  pathGen(civilShadow);
  ctx.fill();

  ctx.fillStyle = nightMode ? 'rgba(5, 0, 1, 0.34)' : 'rgba(4, 8, 18, 0.30)';
  ctx.beginPath();
  pathGen(astronomicalNight);
  ctx.fill();

  // Subtle -6° civil twilight boundary
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = nightMode ? 'rgba(185, 28, 28, 0.48)' : 'rgba(148, 163, 184, 0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  pathGen(civilShadow);
  ctx.stroke();
  ctx.setLineDash([]);

  // Primary 0° Solar Terminator line (bloom halo suppressed in Night Mode)
  if (!nightMode) {
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.30)';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    pathGen(nightHemisphere);
    ctx.stroke();
  }

  ctx.strokeStyle = nightMode ? '#E04826' : '#F59E0B';
  ctx.lineWidth = nightMode ? 1.35 : 1.75;
  ctx.beginPath();
  pathGen(nightHemisphere);
  ctx.stroke();

  const badgeBg = nightMode ? 'rgba(7, 1, 2, 0.90)' : 'rgba(6, 11, 20, 0.85)';
  const sunPt = projection([solar.subsolarLonDeg, solar.subsolarLatDeg]);
  if (sunPt) {
    drawSubsolarBadge(
      ctx,
      sunPt[0],
      sunPt[1],
      `SUN ${formatCoordLat(solar.subsolarLatDeg)} ${formatCoordLon(solar.subsolarLonDeg)}`,
      nightMode ? '#E04826' : '#F59E0B',
      true,
      badgeBg
    );
  }

  const antiPt = projection([solar.antisolarLonDeg, solar.antisolarLatDeg]);
  if (antiPt) {
    drawSubsolarBadge(
      ctx,
      antiPt[0],
      antiPt[1],
      'MIDNIGHT NADIR',
      nightMode ? '#B91C1C' : '#94A3B8',
      false,
      badgeBg
    );
  }

  ctx.restore();
}

/**
 * Renders the crisp D3 orthographic Solar Terminator arc, civil twilight contour, and
 * subsolar/antisolar nadir markers over the 3D shaded globe.
 */
export function renderSolarTerminatorOrthographic(
  ctx: CanvasRenderingContext2D,
  solar: SolarPosition,
  centerLatDeg: number,
  centerLonDeg: number,
  cx: number,
  cy: number,
  radiusPx: number,
  nightMode = false
): void {
  const projection = d3
    .geoOrthographic()
    .rotate([-centerLonDeg, -centerLatDeg])
    .scale(radiusPx)
    .translate([cx, cy])
    .clipAngle(90);

  const pathGen = d3.geoPath(projection, ctx);

  const terminatorLine = d3
    .geoCircle()
    .center([solar.subsolarLonDeg, solar.subsolarLatDeg])
    .radius(90)
    .precision(2)();

  const civilTwilightLine = d3
    .geoCircle()
    .center([solar.antisolarLonDeg, solar.antisolarLatDeg])
    .radius(84)
    .precision(2)();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.clip();

  // Civil twilight (-6°) contour
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = nightMode ? 'rgba(185, 28, 28, 0.48)' : 'rgba(148, 163, 184, 0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  pathGen(civilTwilightLine);
  ctx.stroke();
  ctx.setLineDash([]);

  // Primary 0° Solar Terminator line (bloom halo suppressed in Night Mode)
  if (!nightMode) {
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.34)';
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    pathGen(terminatorLine);
    ctx.stroke();
  }

  ctx.strokeStyle = nightMode ? '#E04826' : '#F59E0B';
  ctx.lineWidth = nightMode ? 1.4 : 1.85;
  ctx.beginPath();
  pathGen(terminatorLine);
  ctx.stroke();

  // Subsolar & antisolar markers only if facing visible hemisphere (>0° angular distance from limb)
  const phi0 = centerLatDeg * DEG_TO_RAD;
  const lam0 = centerLonDeg * DEG_TO_RAD;
  const badgeBg = nightMode ? 'rgba(7, 1, 2, 0.90)' : 'rgba(6, 11, 20, 0.85)';

  const sunCos =
    Math.sin(phi0) * solar.sinDecl +
    Math.cos(phi0) * solar.cosDecl * Math.cos(solar.subsolarLonRad - lam0);
  if (sunCos > 0.04) {
    const sunPt = projection([solar.subsolarLonDeg, solar.subsolarLatDeg]);
    if (sunPt) {
      drawSubsolarBadge(
        ctx,
        sunPt[0],
        sunPt[1],
        `SUN ${formatCoordLat(solar.subsolarLatDeg)} ${formatCoordLon(solar.subsolarLonDeg)}`,
        nightMode ? '#E04826' : '#F59E0B',
        true,
        badgeBg
      );
    }
  }

  const antiLatRad = solar.antisolarLatDeg * DEG_TO_RAD;
  const antiLonRad = solar.antisolarLonDeg * DEG_TO_RAD;
  const antiCos =
    Math.sin(phi0) * Math.sin(antiLatRad) +
    Math.cos(phi0) * Math.cos(antiLatRad) * Math.cos(antiLonRad - lam0);
  if (antiCos > 0.04) {
    const antiPt = projection([solar.antisolarLonDeg, solar.antisolarLatDeg]);
    if (antiPt) {
      drawSubsolarBadge(
        ctx,
        antiPt[0],
        antiPt[1],
        'MIDNIGHT NADIR',
        nightMode ? '#B91C1C' : '#94A3B8',
        false,
        badgeBg
      );
    }
  }

  ctx.restore();
}
