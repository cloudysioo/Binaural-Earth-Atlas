export type LayerKey = 'north' | 'east' | 'south' | 'west';

export type ArchiveYear = 2026 | 2025 | 2007;

export const ARCHIVE_YEARS: ArchiveYear[] = [2026, 2025, 2007];

export interface LayerMetadata {
  key: LayerKey;
  cardinal: 'North' | 'East' | 'South' | 'West';
  shortCardinal: 'N' | 'E' | 'S' | 'W';
  shortcutKey: '1' | '2' | '3' | '4';
  azimuth: 0 | 90 | 180 | 270;
  azimuthLabel: '000°' | '090°' | '180°' | '270°';
  domain: string;
  phenomenon: string;
  gibsLayerId: string;
  fallbackLayerId: string;
  tileMatrixSet: string;
  fallbackTileMatrixSet: string;
  format: 'image/jpeg' | 'image/png';
  waveform: OscillatorType;
  waveformDescription: string;
  position: { x: number; y: number; z: number };
}

export const LAYER_ORDER: LayerKey[] = ['north', 'east', 'south', 'west'];

export const NASA_GIBS_LAYERS: Record<LayerKey, LayerMetadata> = {
  north: {
    key: 'north',
    cardinal: 'North',
    shortCardinal: 'N',
    shortcutKey: '1',
    azimuth: 0,
    azimuthLabel: '000°',
    domain: 'Cryosphere',
    phenomenon: 'Sea Ice Concentration',
    gibsLayerId: 'MODIS_Terra_Sea_Ice',
    fallbackLayerId: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    tileMatrixSet: '1km',
    fallbackTileMatrixSet: '250m',
    format: 'image/png',
    waveform: 'triangle',
    waveformDescription: 'Triangle (Crystalline Polar)',
    position: { x: 0, y: 0, z: -2 },
  },
  east: {
    key: 'east',
    cardinal: 'East',
    shortCardinal: 'E',
    shortcutKey: '2',
    azimuth: 90,
    azimuthLabel: '090°',
    domain: 'Hydrosphere',
    phenomenon: 'Ocean Currents & Chlorophyll-A',
    gibsLayerId: 'MODIS_Aqua_L2_Chlorophyll_A',
    fallbackLayerId: 'MODIS_Aqua_CorrectedReflectance_TrueColor',
    tileMatrixSet: '1km',
    fallbackTileMatrixSet: '250m',
    format: 'image/png',
    waveform: 'sine',
    waveformDescription: 'Sine (Fluid Oceanic)',
    position: { x: 2, y: 0, z: 0 },
  },
  south: {
    key: 'south',
    cardinal: 'South',
    shortCardinal: 'S',
    shortcutKey: '3',
    azimuth: 180,
    azimuthLabel: '180°',
    domain: 'Thermal',
    phenomenon: 'Sea Surface Temperature (SST)',
    gibsLayerId: 'GHRSST_L4_MUR_Sea_Surface_Temperature',
    fallbackLayerId: 'GHRSST_L4_MUR_Sea_Surface_Temperature',
    tileMatrixSet: '1km',
    fallbackTileMatrixSet: '1km',
    format: 'image/png',
    waveform: 'sawtooth',
    waveformDescription: 'Sawtooth (Dense Thermal)',
    position: { x: 0, y: 0, z: 2 },
  },
  west: {
    key: 'west',
    cardinal: 'West',
    shortCardinal: 'W',
    shortcutKey: '4',
    azimuth: 270,
    azimuthLabel: '270°',
    domain: 'Biosphere',
    phenomenon: 'Vegetation Cover (NDVI)',
    gibsLayerId: 'MODIS_Terra_NDVI_8Day',
    fallbackLayerId: 'MODIS_Terra_L3_NDVI_Monthly',
    tileMatrixSet: '250m',
    fallbackTileMatrixSet: '1km',
    format: 'image/png',
    waveform: 'triangle',
    waveformDescription: 'Triangle (Organic Acoustic)',
    position: { x: -2, y: 0, z: 0 },
  },
};

export interface FeatureVector {
  brightness: number;
  hue: number;
  saturation: number;
  edgeDensity: number;
  motion: number;
  climateAnomaly: number;
}

export const EMPTY_FEATURE_VECTOR: FeatureVector = {
  brightness: 0,
  hue: 0,
  saturation: 0,
  edgeDensity: 0,
  motion: 0,
  climateAnomaly: 0,
};

export interface TelemetryPoint {
  monthIndex: number;
  label: string;
  dateStr: string;
  intensity: number;
  anomaly: number;
}

export interface SolarStormLogDetails {
  kpIndex: number;
  stormScale: string;
  auroralPotentialPct: number;
  chimeHz: number;
  freqDeltaHz: number;
  affectedFreqRangeHz: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  tone: 'info' | 'mint' | 'coral' | 'warn';
  category?: 'telemetry' | 'solar_storm';
  solarDetails?: SolarStormLogDetails;
}

export type AudioEventKind =
  | 'climate_anomaly_spike'
  | 'high_intensity_motion'
  | 'solar_activity'
  | 'solar_flare';

export interface AudioEventEntry {
  id: string;
  timestamp: string;
  dateStr: string;
  layerKey: LayerKey;
  kind: AudioEventKind;
  value: number;
  threshold: number;
  frequencyHz: number;
  message: string;
}

export interface SeasonalBenchmark {
  monthIndex: number;
  label: string;
  title: string;
}

export const MONTH_NAMES = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

export function getMaxMonthForYear(year: ArchiveYear): number {
  return year === 2026 ? 11 : 12;
}

export function getSeasonalBenchmarks(year: ArchiveYear): SeasonalBenchmark[] {
  if (year === 2026) {
    return [
      { monthIndex: 1, label: 'JAN', title: 'Boreal Winter Baseline (2026-01-15)' },
      { monthIndex: 3, label: 'MAR', title: 'Arctic Maximum Ice Extent (2026-03-15)' },
      { monthIndex: 6, label: 'JUN', title: 'Summer Melt Onset (2026-06-15)' },
      { monthIndex: 9, label: 'SEP*', title: 'Arctic Sea Ice Summer Minimum (2026-09-15)' },
      { monthIndex: 11, label: 'NOV', title: 'Latest NASA Orbital Pass (2026-11-12)' },
    ];
  }
  return [
    { monthIndex: 1, label: 'JAN', title: `Winter Polar Freeze (${year}-01-15)` },
    { monthIndex: 3, label: 'MAR', title: `Arctic Maximum Ice Extent (${year}-03-15)` },
    { monthIndex: 6, label: 'JUN', title: `Boreal Summer Melt Onset (${year}-06-15)` },
    { monthIndex: 9, label: 'SEP*', title: `Arctic Sea Ice Minimum (${year}-09-15)` },
    { monthIndex: 12, label: 'DEC', title: `Late-Year Ocean & Polar State (${year}-12-15)` },
  ];
}

export function formatArchiveDate(year: ArchiveYear, monthIndex: number): string {
  const maxMonth = getMaxMonthForYear(year);
  const clamped = Math.max(1, Math.min(maxMonth, Math.round(monthIndex)));
  const mm = String(clamped).padStart(2, '0');
  // In November 2026, latest complete GHRSST/MODIS/NDVI composite is 2026-11-12
  const day = year === 2026 && clamped === 11 ? '12' : '15';
  return `${year}-${mm}-${day}`;
}

export function azimuthToLayerKey(angle: number): LayerKey {
  const normalized = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  if (normalized === 0) return 'north';
  if (normalized === 90) return 'east';
  if (normalized === 180) return 'south';
  return 'west';
}
