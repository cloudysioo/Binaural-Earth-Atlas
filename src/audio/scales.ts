export type ScaleMode = 'pentatonic' | 'dorian' | 'harmonic';

export const SCALE_DEFINITIONS: Record<
  ScaleMode,
  { label: string; intervals: readonly number[]; rootHz: number }
> = {
  pentatonic: {
    label: 'A Major Pentatonic',
    intervals: [0, 2, 4, 7, 9],
    rootHz: 110.0,
  },
  dorian: {
    label: 'A Dorian Climate',
    intervals: [0, 2, 3, 5, 7, 9, 10],
    rootHz: 110.0,
  },
  harmonic: {
    label: 'Pure Harmonic Series',
    intervals: [0, 7, 12, 16, 19],
    rootHz: 98.0,
  },
};

export const PENTATONIC_INTERVALS = SCALE_DEFINITIONS.pentatonic.intervals;

export function semitoneToFrequency(rootFreq: number, semitones: number): number {
  return rootFreq * Math.pow(2, semitones / 12);
}

function buildScaleTable(mode: ScaleMode): number[] {
  const { intervals, rootHz } = SCALE_DEFINITIONS[mode];
  const table: number[] = [];
  for (let octave = 0; octave < 3; octave++) {
    for (const interval of intervals) {
      const semitones = octave * 12 + interval;
      table.push(Number(semitoneToFrequency(rootHz, semitones).toFixed(3)));
    }
  }
  return table;
}

const SCALE_TABLES: Record<ScaleMode, number[]> = {
  pentatonic: buildScaleTable('pentatonic'),
  dorian: buildScaleTable('dorian'),
  harmonic: buildScaleTable('harmonic'),
};

export const A_MAJOR_PENTATONIC_TABLE = SCALE_TABLES.pentatonic;

/**
 * Quantizes continuous [0, 1] Hue & Brightness signals into the selected resonant scale.
 */
export function quantizeToPentatonic(
  hue: number,
  brightness: number,
  mode: ScaleMode = 'pentatonic'
): {
  frequency: number;
  noteIndex: number;
  octaveOffset: number;
} {
  const table = SCALE_TABLES[mode];
  const clampedHue = Math.max(0, Math.min(1, hue));
  const clampedBrightness = Math.max(0, Math.min(1, brightness));

  const maxHueStep = Math.max(1, Math.floor(table.length * 0.65));
  const hueStep = Math.floor(clampedHue * (maxHueStep - 0.01));
  const brightnessShift = Math.floor(clampedBrightness * (table.length - maxHueStep));

  const noteIndex = Math.max(0, Math.min(table.length - 1, hueStep + brightnessShift));

  return {
    frequency: table[noteIndex],
    noteIndex,
    octaveOffset: Math.floor(noteIndex / SCALE_DEFINITIONS[mode].intervals.length),
  };
}
