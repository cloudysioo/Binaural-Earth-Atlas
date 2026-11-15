export type ThemeId = 'obsidian' | 'aurora' | 'amber' | 'abyssal' | 'night';

export interface BeaThemePalette {
  id: ThemeId;
  label: string;
  shortLabel: string;
  description: string;
  isNightFilter: boolean;
  cssVars: {
    '--bg-obsidian': string;
    '--bg-console': string;
    '--bg-panel': string;
    '--bg-control': string;
    '--border-grid': string;
    '--border-strong': string;
    '--accent-mint': string;
    '--accent-coral': string;
    '--accent-amber': string;
    '--text-primary': string;
    '--text-muted': string;
  };
  titleGradient: [string, string, string];
  canvas: {
    bg: string;
    bgRgb: [number, number, number];
    bgTooltip: string;
    panelBg: string;
    gridLine: string;
    axisLine: string;
    borderStrong: string;
    textPrimary: string;
    textMuted: string;
    primary: string;
    primaryRgb: string;
    secondary: string;
    secondaryRgb: string;
    tertiary: string;
    tertiaryRgb: string;
    sky: string;
    skyRgb: string;
    coastline: string;
    countryBorder: string;
    terminatorHalo: string;
    terminatorLine: string;
    terminatorTwilight: string;
    terminatorBadgeBg: string;
    auroraCorona: [string, string, string];
    auroraGlitchRgb: string;
    auroraPrimaryRgb: string;
    flarePrimaryRgb: string;
    flareBrightRgb: string;
    windStops: [string, string, string, string];
    stormStops: [string, string, string, string, string];
    scatterLayers: {
      north: string;
      east: string;
      south: string;
      west: string;
    };
    logoStart: string;
    logoMid: string;
    logoEnd: string;
    logoCup: string;
    logoHighlight: string;
    logoLandStroke: string;
    logoLandEast: string;
    logoGrid: string;
  };
}

export const BEA_THEMES: Record<ThemeId, BeaThemePalette> = {
  obsidian: {
    id: 'obsidian',
    label: 'Orbital Cyan',
    shortLabel: 'Cyan',
    description: 'Standard obsidian slate with mint-cyan orbital telemetry',
    isNightFilter: false,
    cssVars: {
      '--bg-obsidian': '#060B14',
      '--bg-console': '#0B1422',
      '--bg-panel': '#122036',
      '--bg-control': '#0F1C30',
      '--border-grid': '#2E4A68',
      '--border-strong': '#4B739C',
      '--accent-mint': '#5EEAD4',
      '--accent-coral': '#FB7185',
      '--accent-amber': '#F59E0B',
      '--text-primary': '#F8FAFC',
      '--text-muted': '#B9C8DC',
    },
    titleGradient: ['#38BDF8', '#2DD4BF', '#5EEAD4'],
    canvas: {
      bg: '#060B14',
      bgRgb: [6, 11, 20],
      bgTooltip: 'rgba(6, 11, 20, 0.95)',
      panelBg: '#122036',
      gridLine: 'rgba(75, 115, 156, 0.42)',
      axisLine: 'rgba(26, 46, 68, 0.85)',
      borderStrong: '#4B739C',
      textPrimary: '#F8FAFC',
      textMuted: '#B9C8DC',
      primary: '#5EEAD4',
      primaryRgb: '94, 234, 212',
      secondary: '#FB7185',
      secondaryRgb: '251, 113, 133',
      tertiary: '#F59E0B',
      tertiaryRgb: '245, 158, 11',
      sky: '#38BDF8',
      skyRgb: '56, 189, 248',
      coastline: 'rgba(241, 245, 249, 0.68)',
      countryBorder: 'rgba(94, 234, 212, 0.30)',
      terminatorHalo: 'rgba(245, 158, 11, 0.32)',
      terminatorLine: '#F59E0B',
      terminatorTwilight: 'rgba(148, 163, 184, 0.45)',
      terminatorBadgeBg: 'rgba(6, 11, 20, 0.86)',
      auroraCorona: ['rgba(110, 231, 183, 0.95)', 'rgba(245, 158, 11, 0.55)', 'rgba(56, 189, 248, 0.25)'],
      auroraGlitchRgb: '251, 191, 36',
      auroraPrimaryRgb: '52, 211, 153',
      flarePrimaryRgb: '251, 113, 133',
      flareBrightRgb: '255, 241, 242',
      windStops: ['#94A3B8', '#5EEAD4', '#38BDF8', '#F59E0B'],
      stormStops: ['#38BDF8', '#5EEAD4', '#F59E0B', '#FB7185', '#FDE047'],
      scatterLayers: {
        north: '#5EEAD4',
        east: '#38BDF8',
        south: '#FB7185',
        west: '#F59E0B',
      },
      logoStart: '#38BDF8',
      logoMid: '#2DD4BF',
      logoEnd: '#5EEAD4',
      logoCup: '#0B1320',
      logoHighlight: '#E0F2FE',
      logoLandStroke: '#BAE6FD',
      logoLandEast: '#CCFBF1',
      logoGrid: '#7DD3FC',
    },
  },

  aurora: {
    id: 'aurora',
    label: 'Polar Aurora',
    shortLabel: 'Aurora',
    description: 'Arctic midnight indigo with auroral emerald and ion violet telemetry',
    isNightFilter: false,
    cssVars: {
      '--bg-obsidian': '#050814',
      '--bg-console': '#0A1024',
      '--bg-panel': '#121B3A',
      '--bg-control': '#0E1630',
      '--border-grid': '#2C3D70',
      '--border-strong': '#4E67AD',
      '--accent-mint': '#34D399',
      '--accent-coral': '#F472B6',
      '--accent-amber': '#A78BFA',
      '--text-primary': '#F1F5F9',
      '--text-muted': '#B3C3E6',
    },
    titleGradient: ['#38BDF8', '#34D399', '#A78BFA'],
    canvas: {
      bg: '#050814',
      bgRgb: [5, 8, 20],
      bgTooltip: 'rgba(5, 8, 20, 0.95)',
      panelBg: '#121B3A',
      gridLine: 'rgba(78, 103, 173, 0.44)',
      axisLine: 'rgba(44, 61, 112, 0.85)',
      borderStrong: '#4E67AD',
      textPrimary: '#F1F5F9',
      textMuted: '#B3C3E6',
      primary: '#34D399',
      primaryRgb: '52, 211, 153',
      secondary: '#F472B6',
      secondaryRgb: '244, 114, 182',
      tertiary: '#A78BFA',
      tertiaryRgb: '167, 139, 250',
      sky: '#38BDF8',
      skyRgb: '56, 189, 248',
      coastline: 'rgba(226, 232, 240, 0.68)',
      countryBorder: 'rgba(52, 211, 153, 0.30)',
      terminatorHalo: 'rgba(167, 139, 250, 0.32)',
      terminatorLine: '#A78BFA',
      terminatorTwilight: 'rgba(148, 163, 184, 0.45)',
      terminatorBadgeBg: 'rgba(5, 8, 20, 0.88)',
      auroraCorona: ['rgba(52, 211, 153, 0.95)', 'rgba(167, 139, 250, 0.55)', 'rgba(56, 189, 248, 0.25)'],
      auroraGlitchRgb: '167, 139, 250',
      auroraPrimaryRgb: '52, 211, 153',
      flarePrimaryRgb: '244, 114, 182',
      flareBrightRgb: '253, 242, 248',
      windStops: ['#94A3B8', '#34D399', '#38BDF8', '#A78BFA'],
      stormStops: ['#38BDF8', '#34D399', '#A78BFA', '#F472B6', '#FDE047'],
      scatterLayers: {
        north: '#34D399',
        east: '#38BDF8',
        south: '#F472B6',
        west: '#A78BFA',
      },
      logoStart: '#38BDF8',
      logoMid: '#34D399',
      logoEnd: '#A78BFA',
      logoCup: '#0B1124',
      logoHighlight: '#E0F2FE',
      logoLandStroke: '#A7F3D0',
      logoLandEast: '#DDD6FE',
      logoGrid: '#818CF8',
    },
  },

  amber: {
    id: 'amber',
    label: 'Amber CRT',
    shortLabel: 'Amber',
    description: 'Flight-deck phosphor gold and warm aerospace telemetry charcoal',
    isNightFilter: false,
    cssVars: {
      '--bg-obsidian': '#0A0804',
      '--bg-console': '#141008',
      '--bg-panel': '#211A0D',
      '--bg-control': '#1A150A',
      '--border-grid': '#5C4822',
      '--border-strong': '#997838',
      '--accent-mint': '#FBBF24',
      '--accent-coral': '#FB7185',
      '--accent-amber': '#4ADE80',
      '--text-primary': '#FEF3C7',
      '--text-muted': '#D6B87A',
    },
    titleGradient: ['#FDE68A', '#FBBF24', '#FB923C'],
    canvas: {
      bg: '#0A0804',
      bgRgb: [10, 8, 4],
      bgTooltip: 'rgba(10, 8, 4, 0.95)',
      panelBg: '#211A0D',
      gridLine: 'rgba(153, 120, 56, 0.45)',
      axisLine: 'rgba(92, 72, 34, 0.85)',
      borderStrong: '#997838',
      textPrimary: '#FEF3C7',
      textMuted: '#D6B87A',
      primary: '#FBBF24',
      primaryRgb: '251, 191, 36',
      secondary: '#FB7185',
      secondaryRgb: '251, 113, 133',
      tertiary: '#4ADE80',
      tertiaryRgb: '74, 222, 128',
      sky: '#FB923C',
      skyRgb: '251, 146, 60',
      coastline: 'rgba(254, 243, 199, 0.65)',
      countryBorder: 'rgba(251, 191, 36, 0.28)',
      terminatorHalo: 'rgba(251, 191, 36, 0.30)',
      terminatorLine: '#FBBF24',
      terminatorTwilight: 'rgba(214, 184, 122, 0.45)',
      terminatorBadgeBg: 'rgba(10, 8, 4, 0.90)',
      auroraCorona: ['rgba(251, 191, 36, 0.95)', 'rgba(74, 222, 128, 0.55)', 'rgba(251, 146, 60, 0.25)'],
      auroraGlitchRgb: '74, 222, 128',
      auroraPrimaryRgb: '251, 191, 36',
      flarePrimaryRgb: '251, 113, 133',
      flareBrightRgb: '254, 243, 199',
      windStops: ['#A89060', '#FBBF24', '#FB923C', '#4ADE80'],
      stormStops: ['#FDE68A', '#FBBF24', '#FB923C', '#FB7185', '#4ADE80'],
      scatterLayers: {
        north: '#FBBF24',
        east: '#FB923C',
        south: '#FB7185',
        west: '#4ADE80',
      },
      logoStart: '#FDE68A',
      logoMid: '#FBBF24',
      logoEnd: '#FB923C',
      logoCup: '#141008',
      logoHighlight: '#FEF3C7',
      logoLandStroke: '#FDE68A',
      logoLandEast: '#FED7AA',
      logoGrid: '#D97706',
    },
  },

  abyssal: {
    id: 'abyssal',
    label: 'Abyssal Sonar',
    shortLabel: 'Abyssal',
    description: 'Deep bathymetric cobalt trench with sonar azure & cyan highlights',
    isNightFilter: false,
    cssVars: {
      '--bg-obsidian': '#030812',
      '--bg-console': '#071224',
      '--bg-panel': '#0D1E3B',
      '--bg-control': '#0A1830',
      '--border-grid': '#1E4370',
      '--border-strong': '#366FA8',
      '--accent-mint': '#38BDF8',
      '--accent-coral': '#F472B6',
      '--accent-amber': '#22D3EE',
      '--text-primary': '#F0F9FF',
      '--text-muted': '#9EC5E8',
    },
    titleGradient: ['#60A5FA', '#38BDF8', '#22D3EE'],
    canvas: {
      bg: '#030812',
      bgRgb: [3, 8, 18],
      bgTooltip: 'rgba(3, 8, 18, 0.95)',
      panelBg: '#0D1E3B',
      gridLine: 'rgba(54, 111, 168, 0.44)',
      axisLine: 'rgba(30, 67, 112, 0.85)',
      borderStrong: '#366FA8',
      textPrimary: '#F0F9FF',
      textMuted: '#9EC5E8',
      primary: '#38BDF8',
      primaryRgb: '56, 189, 248',
      secondary: '#F472B6',
      secondaryRgb: '244, 114, 182',
      tertiary: '#22D3EE',
      tertiaryRgb: '34, 211, 238',
      sky: '#818CF8',
      skyRgb: '129, 140, 248',
      coastline: 'rgba(224, 242, 254, 0.68)',
      countryBorder: 'rgba(56, 189, 248, 0.32)',
      terminatorHalo: 'rgba(34, 211, 238, 0.30)',
      terminatorLine: '#22D3EE',
      terminatorTwilight: 'rgba(158, 197, 232, 0.45)',
      terminatorBadgeBg: 'rgba(3, 8, 18, 0.88)',
      auroraCorona: ['rgba(56, 189, 248, 0.95)', 'rgba(34, 211, 238, 0.55)', 'rgba(129, 140, 248, 0.25)'],
      auroraGlitchRgb: '34, 211, 238',
      auroraPrimaryRgb: '56, 189, 248',
      flarePrimaryRgb: '244, 114, 182',
      flareBrightRgb: '240, 249, 255',
      windStops: ['#64748B', '#38BDF8', '#22D3EE', '#818CF8'],
      stormStops: ['#60A5FA', '#38BDF8', '#22D3EE', '#F472B6', '#FDE047'],
      scatterLayers: {
        north: '#38BDF8',
        east: '#22D3EE',
        south: '#F472B6',
        west: '#818CF8',
      },
      logoStart: '#60A5FA',
      logoMid: '#38BDF8',
      logoEnd: '#22D3EE',
      logoCup: '#071224',
      logoHighlight: '#E0F2FE',
      logoLandStroke: '#BAE6FD',
      logoLandEast: '#A5F3FC',
      logoGrid: '#38BDF8',
    },
  },

  night: {
    id: 'night',
    label: 'Night Crimson',
    shortLabel: 'Crimson',
    description: 'Dark-adapted observatory deep red palette with reduced canvas bloom',
    isNightFilter: true,
    cssVars: {
      '--bg-obsidian': '#070102',
      '--bg-console': '#120407',
      '--bg-panel': '#1D070C',
      '--bg-control': '#19060B',
      '--border-grid': '#7A1E2B',
      '--border-strong': '#C23042',
      '--accent-mint': '#FF453A',
      '--accent-coral': '#FF7A59',
      '--accent-amber': '#F0522E',
      '--text-primary': '#FF7875',
      '--text-muted': '#F47272',
    },
    titleGradient: ['#B91C1C', '#DC2626', '#FF453A'],
    canvas: {
      bg: '#070102',
      bgRgb: [7, 1, 2],
      bgTooltip: 'rgba(7, 1, 2, 0.95)',
      panelBg: '#1D070C',
      gridLine: 'rgba(194, 48, 66, 0.45)',
      axisLine: 'rgba(77, 17, 25, 0.85)',
      borderStrong: '#C23042',
      textPrimary: '#FF7875',
      textMuted: '#F47272',
      primary: '#FF453A',
      primaryRgb: '255, 69, 58',
      secondary: '#FF7A59',
      secondaryRgb: '255, 122, 89',
      tertiary: '#F0522E',
      tertiaryRgb: '240, 82, 46',
      sky: '#DC2626',
      skyRgb: '220, 38, 38',
      coastline: 'rgba(239, 68, 68, 0.56)',
      countryBorder: 'rgba(185, 28, 28, 0.32)',
      terminatorHalo: 'rgba(224, 72, 38, 0.22)',
      terminatorLine: '#E04826',
      terminatorTwilight: 'rgba(185, 28, 28, 0.48)',
      terminatorBadgeBg: 'rgba(7, 1, 2, 0.90)',
      auroraCorona: ['rgba(255, 130, 80, 0.9)', 'rgba(255, 59, 48, 0.48)', 'rgba(255, 59, 48, 0)'],
      auroraGlitchRgb: '255, 140, 82',
      auroraPrimaryRgb: '255, 68, 56',
      flarePrimaryRgb: '255, 76, 68',
      flareBrightRgb: '255, 118, 92',
      windStops: ['#7F1D1D', '#B91C1C', '#DC2626', '#FF3B30'],
      stormStops: ['#991B1B', '#B91C1C', '#DC2626', '#FF453A', '#FF7875'],
      scatterLayers: {
        north: '#FF453A',
        east: '#F0522E',
        south: '#FF7A59',
        west: '#DC2626',
      },
      logoStart: '#B91C1C',
      logoMid: '#DC2626',
      logoEnd: '#FF3B30',
      logoCup: '#100305',
      logoHighlight: '#FF6B4A',
      logoLandStroke: '#FF5C58',
      logoLandEast: '#FF3B30',
      logoGrid: '#DC2626',
    },
  },
};

export const THEME_ORDER: ThemeId[] = ['obsidian', 'aurora', 'amber', 'abyssal', 'night'];

export function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === 'string' &&
    (value === 'obsidian' ||
      value === 'aurora' ||
      value === 'amber' ||
      value === 'abyssal' ||
      value === 'night')
  );
}

export function resolveTheme(theme?: BeaThemePalette, nightMode = false): BeaThemePalette {
  if (theme) return theme;
  return nightMode ? BEA_THEMES.night : BEA_THEMES.obsidian;
}

export function applyThemeCssVars(theme: BeaThemePalette): void {
  const root = document.documentElement;
  root.classList.toggle('observatory-night', theme.isNightFilter);
  root.dataset.theme = theme.id;
  for (const [key, val] of Object.entries(theme.cssVars)) {
    root.style.setProperty(key, val);
  }
}
