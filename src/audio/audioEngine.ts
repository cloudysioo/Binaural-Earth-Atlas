import {
  HeadingWindTelemetry,
  sampleWindAlongHeading,
  WindVectorField,
} from '../analysis/windVectorField';
import {
  AudioEventEntry,
  FeatureVector,
  LAYER_ORDER,
  LayerKey,
  NASA_GIBS_LAYERS,
} from '../types/bea';
import { AtmosphericFlowSynth } from './atmosphericFlowSynth';
import { LayerSynth } from './layerSynth';
import { quantizeToPentatonic, ScaleMode } from './scales';
import { SpatialPanner } from './spatialPanner';

export type EnvironmentReverbMode = 'vacuum' | 'atmospheric';
export type SpatialPanningMode = 'cardinal' | 'smooth360';

export interface DopplerShiftTelemetry {
  beta: number;
  multiplier: number;
  shiftPct: number;
  cents: number;
}

const NEUTRAL_DOPPLER: DopplerShiftTelemetry = {
  beta: 0,
  multiplier: 1,
  shiftPct: 0,
  cents: 0,
};

/**
 * Generates a deterministic stereo planetary-atmospheric impulse response
 * with early horizon reflections and frequency-damped exponential tail.
 */
function createAtmosphericImpulseResponse(
  ctx: AudioContext,
  durationSec = 2.8,
  decay = 2.5
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * durationSec));
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const fadeSamples = Math.max(1, Math.floor(sampleRate * 0.018));

  for (let ch = 0; ch < 2; ch++) {
    const channelData = buffer.getChannelData(ch);
    let seed = ch === 0 ? 0x9e3779b9 : 0x85ebca6b;
    let lpState = 0;

    for (let i = 0; i < length; i++) {
      // Deterministic LCG PRNG in [-1, +1]
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const white = (seed / 0xffffffff) * 2 - 1;

      // Gentle air-absorption lowpass smoothing
      lpState = lpState * 0.72 + white * 0.28;

      const attackEnv = i < fadeSamples ? i / fadeSamples : 1;
      const decayEnv = Math.pow(1 - i / length, decay);
      channelData[i] = lpState * attackEnv * decayEnv;
    }

    // Subtle early planetary scatter reflections (18ms..115ms)
    const tapsMs = ch === 0 ? [18, 43, 76, 108] : [24, 51, 84, 117];
    tapsMs.forEach((ms, idx) => {
      const tapSample = Math.floor((ms / 1000) * sampleRate);
      if (tapSample < length) {
        channelData[tapSample] += (idx % 2 === 0 ? 1 : -1) * (0.28 / (idx + 1));
      }
    });
  }

  return buffer;
}

export class AudioEngine {
  public static readonly HEADING_CROSSFADE_SEC = 0.5;
  public static readonly ANOMALY_SPIKE_THRESHOLD = 0.44;
  public static readonly HIGH_MOTION_THRESHOLD = 0.48;
  private ctx: AudioContext | null = null;
  private spatialBus: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private reverbToneFilter: BiquadFilterNode | null = null;
  private wetGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;
  private spatialPanner: SpatialPanner | null = null;
  private synths: Record<LayerKey, LayerSynth> | null = null;
  private atmosphericFlow: AtmosphericFlowSynth | null = null;
  private windField: WindVectorField | null = null;
  private atmosphericFlowEnabled = true;
  private masterVolume = 0.72;
  private activeHeading = 0;
  private scaleMode: ScaleMode = 'pentatonic';
  private reverbMode: EnvironmentReverbMode = 'vacuum';
  private panningMode: SpatialPanningMode = 'smooth360';
  private isAudioRunning = false;
  private testTimers: number[] = [];
  private audioEventListener: ((event: AudioEventEntry) => void) | null = null;
  private prev2007Anomalies: Partial<Record<LayerKey, number>> = {};
  private lastDopplerByLayer: Record<LayerKey, DopplerShiftTelemetry> = {
    north: { ...NEUTRAL_DOPPLER },
    east: { ...NEUTRAL_DOPPLER },
    south: { ...NEUTRAL_DOPPLER },
    west: { ...NEUTRAL_DOPPLER },
  };

  public setAudioEventListener(listener: ((event: AudioEventEntry) => void) | null): void {
    this.audioEventListener = listener;
  }

  public resetArchiveEventHistory(): void {
    this.prev2007Anomalies = {};
  }

  /**
   * Computes classical approaching-source Doppler pitch shift f' = f / (1 - v/c)
   * combining the layer's Frame Motion velocity and sequencer cadence speedup.
   */
  public static computeDopplerShift(
    frameMotion: number,
    cadenceMs: number
  ): DopplerShiftTelemetry {
    const clampedMotion = Math.max(0, Math.min(1, Number.isFinite(frameMotion) ? frameMotion : 0));
    const sequencerSpeed = Math.max(
      0,
      Math.min(1, (2500 - (Number.isFinite(cadenceMs) ? cadenceMs : 2500)) / 1000)
    );
    const velocityNorm = Math.max(0, Math.min(1, 0.55 * clampedMotion + 0.45 * sequencerSpeed));
    const beta = 0.125 * velocityNorm;
    const multiplier = 1 / (1 - beta);
    const shiftPct = (multiplier - 1) * 100;
    const cents = Math.round(1200 * Math.log2(multiplier));
    return { beta, multiplier, shiftPct, cents };
  }

  public getDopplerTelemetry(): Record<LayerKey, DopplerShiftTelemetry> {
    return this.lastDopplerByLayer;
  }

  public isInitialized(): boolean {
    return this.ctx !== null;
  }

  public isRunning(): boolean {
    return this.isAudioRunning;
  }

  public setScaleMode(mode: ScaleMode): void {
    this.scaleMode = mode;
  }

  public getEnvironmentReverb(): EnvironmentReverbMode {
    return this.reverbMode;
  }

  public setEnvironmentReverb(mode: EnvironmentReverbMode): void {
    this.reverbMode = mode;
    if (this.ctx && this.dryGain && this.wetGain) {
      const now = this.ctx.currentTime;
      const targetDry = mode === 'atmospheric' ? 0.72 : 1.0;
      const targetWet = mode === 'atmospheric' ? 0.46 : 0.0;
      this.dryGain.gain.setTargetAtTime(targetDry, now, 0.08);
      this.wetGain.gain.setTargetAtTime(targetWet, now, 0.08);
    }
  }

  public getPanningMode(): SpatialPanningMode {
    return this.panningMode;
  }

  public setPanningMode(mode: SpatialPanningMode): void {
    this.panningMode = mode;
    this.setHeading(this.activeHeading, AudioEngine.HEADING_CROSSFADE_SEC);
  }

  public getEffectiveHeading(): number {
    if (this.panningMode === 'cardinal') {
      return ((Math.round(this.activeHeading / 90) * 90) % 360 + 360) % 360;
    }
    return this.activeHeading;
  }

  public isAtmosphericFlowEnabled(): boolean {
    return this.atmosphericFlowEnabled;
  }

  public setAtmosphericFlowEnabled(enabled: boolean): void {
    this.atmosphericFlowEnabled = enabled;
    this.atmosphericFlow?.setEnabled(enabled);
  }

  public updateWindField(field: WindVectorField): HeadingWindTelemetry {
    this.windField = field;
    const effectiveHeading = this.getEffectiveHeading();
    const telemetry = sampleWindAlongHeading(field, effectiveHeading);
    this.atmosphericFlow?.updateFromWind(telemetry, effectiveHeading);
    return telemetry;
  }

  public getHeadingWindTelemetry(headingDeg = this.getEffectiveHeading()): HeadingWindTelemetry | null {
    if (!this.windField) return null;
    return sampleWindAlongHeading(this.windField, headingDeg);
  }

  public getAnalyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  /**
   * Instantiates and resumes AudioContext strictly inside a user gesture handler.
   */
  public async initOnUserGesture(): Promise<AudioContext> {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.spatialBus = this.ctx.createGain();
      this.spatialBus.gain.setValueAtTime(1.0, this.ctx.currentTime);

      this.dryGain = this.ctx.createGain();
      this.dryGain.gain.setValueAtTime(
        this.reverbMode === 'atmospheric' ? 0.72 : 1.0,
        this.ctx.currentTime
      );

      this.convolver = this.ctx.createConvolver();
      this.convolver.normalize = true;
      this.convolver.buffer = createAtmosphericImpulseResponse(this.ctx, 2.8, 2.5);

      this.reverbToneFilter = this.ctx.createBiquadFilter();
      this.reverbToneFilter.type = 'lowpass';
      this.reverbToneFilter.frequency.setValueAtTime(3600, this.ctx.currentTime);
      this.reverbToneFilter.Q.setValueAtTime(0.6, this.ctx.currentTime);

      this.wetGain = this.ctx.createGain();
      this.wetGain.gain.setValueAtTime(
        this.reverbMode === 'atmospheric' ? 0.46 : 0.0,
        this.ctx.currentTime
      );

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-18, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(12, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(6, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.15, this.ctx.currentTime);

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.78;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);

      // Parallel Dry (Vacuum/Deep Space) + Wet Convolution (Planetary Atmospheric) routing
      this.spatialBus.connect(this.dryGain);
      this.dryGain.connect(this.compressor);

      this.spatialBus.connect(this.convolver);
      this.convolver.connect(this.reverbToneFilter);
      this.reverbToneFilter.connect(this.wetGain);
      this.wetGain.connect(this.compressor);

      this.compressor.connect(this.analyser);
      this.analyser.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.spatialPanner = new SpatialPanner(this.ctx, this.spatialBus);

      const synthMap = {} as Record<LayerKey, LayerSynth>;
      for (const key of LAYER_ORDER) {
        synthMap[key] = new LayerSynth(this.ctx, key, this.spatialPanner.getPanner(key));
      }
      this.synths = synthMap;

      this.atmosphericFlow = new AtmosphericFlowSynth(this.ctx, this.spatialBus);
      this.atmosphericFlow.setEnabled(this.atmosphericFlowEnabled);
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.setHeading(this.activeHeading, 0.02);
    return this.ctx;
  }

  public async start(): Promise<void> {
    await this.initOnUserGesture();
    if (!this.synths) return;
    for (const key of LAYER_ORDER) {
      this.synths[key].start();
    }
    this.atmosphericFlow?.setEnabled(this.atmosphericFlowEnabled);
    this.atmosphericFlow?.start();
    this.isAudioRunning = true;
    this.setHeading(this.activeHeading, 0.02);
  }

  public stop(): void {
    this.clearTestTimers();
    if (this.synths) {
      for (const key of LAYER_ORDER) {
        this.synths[key].stop();
      }
    }
    this.atmosphericFlow?.stop();
    this.isAudioRunning = false;
  }

  public setMasterVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.masterVolume = clamped;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.04);
    }
  }

  public setHeading(
    headingDegrees: number,
    crossfadeDurationSec = AudioEngine.HEADING_CROSSFADE_SEC
  ): void {
    this.activeHeading = ((headingDegrees % 360) + 360) % 360;
    const effectiveHeading = this.getEffectiveHeading();

    const updateWindAtAngle = (angleDeg: number) => {
      if (this.windField && this.atmosphericFlow) {
        const telemetry = sampleWindAlongHeading(this.windField, angleDeg);
        this.atmosphericFlow.updateFromWind(telemetry, angleDeg);
      }
    };

    const applyContinuousFocusAtAngle = (interpolatedDeg: number) => {
      if (this.synths) {
        for (const key of LAYER_ORDER) {
          const layerAzimuth = NASA_GIBS_LAYERS[key].azimuth;
          const delta = Math.abs(interpolatedDeg - layerAzimuth);
          const shortest = Math.min(delta, 360 - delta);
          this.synths[key].setContinuousAngularFocus(shortest, 0.024);
        }
      }
      updateWindAtAngle(interpolatedDeg);
    };

    if (this.panningMode === 'smooth360') {
      if (this.spatialPanner) {
        this.spatialPanner.updateListenerOrientation(
          effectiveHeading,
          crossfadeDurationSec,
          'smooth360',
          applyContinuousFocusAtAngle
        );
      } else {
        applyContinuousFocusAtAngle(effectiveHeading);
      }
      return;
    }

    if (this.spatialPanner) {
      this.spatialPanner.updateListenerOrientation(
        effectiveHeading,
        crossfadeDurationSec,
        'cardinal'
      );
    }

    if (this.synths) {
      for (const key of LAYER_ORDER) {
        const layerAzimuth = NASA_GIBS_LAYERS[key].azimuth;
        const delta = Math.abs(effectiveHeading - layerAzimuth);
        const shortest = Math.min(delta, 360 - delta);
        this.synths[key].setAngularFocus(shortest, crossfadeDurationSec);
      }
    }
    updateWindAtAngle(effectiveHeading);
  }

  /**
   * Evaluates 2007 archive telemetry for Climate Anomaly Spikes or High Intensity Motion
   * events identified by the AudioEngine and emits structured AudioEventEntry records.
   */
  public evaluateArchiveEvents(
    vectors: Record<LayerKey, FeatureVector>,
    cadenceMs: number,
    dateStr: string
  ): AudioEventEntry[] {
    if (!dateStr.startsWith('2007-')) return [];

    const timestamp = new Date().toISOString().slice(11, 19);
    const detected: AudioEventEntry[] = [];

    for (const key of LAYER_ORDER) {
      const vec = vectors[key];
      const meta = NASA_GIBS_LAYERS[key];
      const doppler = AudioEngine.computeDopplerShift(vec.motion, cadenceMs);
      const baseFreq = quantizeToPentatonic(vec.hue, vec.brightness, this.scaleMode).frequency;
      const frequencyHz = Math.round(baseFreq * doppler.multiplier);

      const prevAnomaly = this.prev2007Anomalies[key];
      const deltaAnomaly = prevAnomaly !== undefined ? vec.climateAnomaly - prevAnomaly : 0;
      const isAnomalySpike =
        vec.climateAnomaly >= AudioEngine.ANOMALY_SPIKE_THRESHOLD ||
        (deltaAnomaly >= 0.12 && vec.climateAnomaly >= 0.34);

      this.prev2007Anomalies[key] = vec.climateAnomaly;

      if (isAnomalySpike) {
        const entry: AudioEventEntry = {
          id: `evt-anom-${dateStr}-${key}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp,
          dateStr,
          layerKey: key,
          kind: 'climate_anomaly_spike',
          value: vec.climateAnomaly,
          threshold: AudioEngine.ANOMALY_SPIKE_THRESHOLD,
          frequencyHz,
          message: `CLIMATE ANOMALY SPIKE · ${meta.cardinal.toUpperCase()} (${meta.azimuthLabel} ${meta.domain.toUpperCase()}) · ${(
            vec.climateAnomaly * 100
          ).toFixed(1)}% TENSION → ${frequencyHz} HZ DETUNED`,
        };
        detected.push(entry);
        this.audioEventListener?.(entry);
      }

      if (vec.motion >= AudioEngine.HIGH_MOTION_THRESHOLD) {
        const entry: AudioEventEntry = {
          id: `evt-mot-${dateStr}-${key}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp,
          dateStr,
          layerKey: key,
          kind: 'high_intensity_motion',
          value: vec.motion,
          threshold: AudioEngine.HIGH_MOTION_THRESHOLD,
          frequencyHz,
          message: `HIGH INTENSITY MOTION · ${meta.cardinal.toUpperCase()} (${meta.azimuthLabel} ${meta.domain.toUpperCase()}) · ${(
            vec.motion * 100
          ).toFixed(1)}% VELOCITY → DOPPLER +${doppler.shiftPct.toFixed(1)}% (${frequencyHz} HZ)`,
        };
        detected.push(entry);
        this.audioEventListener?.(entry);
      }
    }

    return detected;
  }

  public updateAllLayers(
    vectors: Record<LayerKey, FeatureVector>,
    cadenceMs: number,
    dateStr?: string
  ): Record<LayerKey, number> {
    const freqs: Record<LayerKey, number> = {
      north: 0,
      east: 0,
      south: 0,
      west: 0,
    };

    for (const key of LAYER_ORDER) {
      const doppler = AudioEngine.computeDopplerShift(vectors[key].motion, cadenceMs);
      this.lastDopplerByLayer[key] = doppler;
      if (this.synths && this.isAudioRunning) {
        freqs[key] = this.synths[key].updateFromFeatures(
          vectors[key],
          cadenceMs,
          this.scaleMode,
          doppler.multiplier
        );
      }
    }

    if (dateStr) {
      this.evaluateArchiveEvents(vectors, cadenceMs, dateStr);
    }

    return freqs;
  }

  public async testSpatialAudio(
    onStep?: (layerKey: LayerKey, stepIndex: number) => void,
    onComplete?: () => void
  ): Promise<void> {
    this.clearTestTimers();
    await this.initOnUserGesture();
    if (!this.synths || !this.spatialPanner) return;

    for (const key of LAYER_ORDER) {
      this.synths[key].start();
    }

    this.spatialPanner.updateListenerOrientation(
      this.getEffectiveHeading(),
      0.02,
      this.panningMode
    );

    LAYER_ORDER.forEach((key, index) => {
      const timerId = window.setTimeout(() => {
        if (!this.synths) return;
        this.synths[key].triggerCalibrationPing(0.5);
        onStep?.(key, index);

        if (index === LAYER_ORDER.length - 1) {
          const endTimer = window.setTimeout(() => {
            if (!this.isAudioRunning && this.synths) {
              for (const k of LAYER_ORDER) {
                this.synths[k].stop();
              }
            } else {
              this.setHeading(this.activeHeading);
            }
            onComplete?.();
          }, 600);
          this.testTimers.push(endTimer);
        }
      }, index * 580);
      this.testTimers.push(timerId);
    });
  }

  private clearTestTimers(): void {
    for (const id of this.testTimers) {
      window.clearTimeout(id);
    }
    this.testTimers = [];
  }

  public dispose(): void {
    this.clearTestTimers();
    this.spatialPanner?.dispose();
    this.atmosphericFlow?.dispose();
    this.atmosphericFlow = null;
    if (this.synths) {
      for (const key of LAYER_ORDER) {
        this.synths[key].dispose();
      }
      this.synths = null;
    }
    this.spatialBus?.disconnect();
    this.dryGain?.disconnect();
    this.convolver?.disconnect();
    this.reverbToneFilter?.disconnect();
    this.wetGain?.disconnect();
    this.compressor?.disconnect();
    this.analyser?.disconnect();
    this.masterGain?.disconnect();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
