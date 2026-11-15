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
import { SolarActivityTelemetry } from '../analysis/solarActivity';
import { AtmosphericFlowSynth } from './atmosphericFlowSynth';
import { LayerSynth } from './layerSynth';
import { quantizeToPentatonic, ScaleMode } from './scales';
import { SolarChimeSynth } from './solarChimeSynth';
import { SolarFlareSynth } from './solarFlareSynth';
import { SpatialPanner } from './spatialPanner';

export type EnvironmentReverbMode = 'vacuum' | 'atmospheric';
export type SpatialPanningMode = 'cardinal' | 'smooth360';

export type DopplerDirection = 'up' | 'down' | 'flat';

export interface DopplerShiftTelemetry {
  beta: number;
  multiplier: number;
  shiftPct: number;
  cents: number;
  direction: DopplerDirection;
  motionDelta: number;
}

const NEUTRAL_DOPPLER: DopplerShiftTelemetry = {
  beta: 0,
  multiplier: 1,
  shiftPct: 0,
  cents: 0,
  direction: 'flat',
  motionDelta: 0,
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
  public static readonly MAGNETIC_ANOMALY_THRESHOLD = 0.36;
  public static readonly SOLAR_ACTIVITY_THRESHOLD = 0.68;
  public static readonly SOLAR_WIND_FLARE_THRESHOLD_KMS = 680;
  public static readonly SOLAR_WIND_SPIKE_DELTA_KMS = 95;
  public static readonly DOPPLER_EMA_ALPHA = 0.28;
  private ctx: AudioContext | null = null;
  private spatialBus: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private reverbToneFilter: BiquadFilterNode | null = null;
  private wetGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private narrationDuckGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;
  private spatialPanner: SpatialPanner | null = null;
  private synths: Record<LayerKey, LayerSynth> | null = null;
  private atmosphericFlow: AtmosphericFlowSynth | null = null;
  private solarChime: SolarChimeSynth | null = null;
  private solarFlareSynth: SolarFlareSynth | null = null;
  private windField: WindVectorField | null = null;
  private atmosphericFlowEnabled = true;
  private windTurbulenceMultiplier = 1.0;
  private dopplerSensitivity = 1.0;
  private magneticSnapEnabled = false;
  private latestVectors: Record<LayerKey, FeatureVector> | null = null;
  private lastMagneticDetentKey: LayerKey | null = null;
  private lastMagneticDetentMs = 0;
  private prevHeadingForAnomalyCross: number | null = null;
  private isNarrationActive = false;
  private masterVolume = 0.55;
  private activeHeading = 0;
  private scaleMode: ScaleMode = 'pentatonic';
  private reverbMode: EnvironmentReverbMode = 'vacuum';
  private panningMode: SpatialPanningMode = 'smooth360';
  private isAudioRunning = false;
  private testTimers: number[] = [];
  private audioEventListener: ((event: AudioEventEntry) => void) | null = null;
  private prev2007Anomalies: Partial<Record<LayerKey, number>> = {};
  private lastSolarTriggerMs = 0;
  private prevSolarIntensity = 0;
  private prevSolarWindKms: number | null = null;
  private lastSolarFlareMs = 0;
  private prevMotionByLayer: Partial<Record<LayerKey, number>> = {};
  private currentFrameMotionByLayer: Partial<Record<LayerKey, number>> = {};
  private lastMotionFrameDate: string | null = null;
  private smoothedDopplerMultiplier: Partial<Record<LayerKey, number>> = {};
  private lastDopplerStepKey: string | null = null;
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
    this.prevMotionByLayer = {};
    this.currentFrameMotionByLayer = {};
    this.lastMotionFrameDate = null;
    this.smoothedDopplerMultiplier = {};
    this.lastDopplerStepKey = null;
    this.lastDopplerByLayer = {
      north: { ...NEUTRAL_DOPPLER },
      east: { ...NEUTRAL_DOPPLER },
      south: { ...NEUTRAL_DOPPLER },
      west: { ...NEUTRAL_DOPPLER },
    };
  }

  private commitMotionFrame(vectors: Record<LayerKey, FeatureVector>, dateStr?: string): void {
    if (!dateStr || dateStr === this.lastMotionFrameDate) return;
    this.prevMotionByLayer = { ...this.currentFrameMotionByLayer };
    for (const key of LAYER_ORDER) {
      this.currentFrameMotionByLayer[key] = vectors[key].motion;
    }
    this.lastMotionFrameDate = dateStr;
  }

  /**
   * Computes signed Doppler pitch shift f' = f / (1 - v/c) combining each
   * layer's Frame Motion velocity, frame-to-frame acceleration/deceleration delta,
   * and sequencer cadence speed, scales deviation by dopplerSensitivity [0..3],
   * and smooths the resulting multiplier through an EMA filter.
   */
  public static computeDopplerShift(
    frameMotion: number,
    cadenceMs: number,
    previousMotion?: number,
    previousSmoothedMultiplier?: number,
    emaAlpha = AudioEngine.DOPPLER_EMA_ALPHA,
    sensitivity = 1.0
  ): DopplerShiftTelemetry {
    const clampedMotion = Math.max(0, Math.min(1, Number.isFinite(frameMotion) ? frameMotion : 0));
    const clampedPrev =
      previousMotion !== undefined && Number.isFinite(previousMotion)
        ? Math.max(0, Math.min(1, previousMotion))
        : undefined;
    const motionDelta = clampedPrev !== undefined ? clampedMotion - clampedPrev : 0;

    const sequencerSpeed = Math.max(
      0,
      Math.min(1, (2500 - (Number.isFinite(cadenceMs) ? cadenceMs : 2500)) / 1000)
    );
    const motionBaseline =
      clampedMotion >= 0.22 ? (clampedMotion - 0.22) / 0.78 : (clampedMotion - 0.22) / 0.22;
    const velocitySigned = Math.max(
      -0.85,
      Math.min(1, 0.5 * motionBaseline + 0.38 * sequencerSpeed + 0.35 * motionDelta)
    );
    const beta = Math.max(-0.1, Math.min(0.125, 0.125 * velocitySigned));
    const rawBaseMultiplier = 1 / (1 - beta);
    const clampedSens = Math.max(0, Math.min(3, Number.isFinite(sensitivity) ? sensitivity : 1.0));
    const rawMultiplier = Math.max(
      0.55,
      Math.min(1.85, 1 + (rawBaseMultiplier - 1) * clampedSens)
    );

    const hasPrevEma =
      previousSmoothedMultiplier !== undefined && Number.isFinite(previousSmoothedMultiplier);
    const alpha = Math.max(0.05, Math.min(1, emaAlpha));
    const multiplier = hasPrevEma
      ? alpha * rawMultiplier + (1 - alpha) * previousSmoothedMultiplier
      : rawMultiplier;

    const shiftPct = (multiplier - 1) * 100;
    const cents = Math.round(1200 * Math.log2(multiplier));
    const direction: DopplerDirection =
      shiftPct > 0.15 ? 'up' : shiftPct < -0.15 ? 'down' : 'flat';
    return { beta, multiplier, shiftPct, cents, direction, motionDelta };
  }

  public getDopplerSensitivity(): number {
    return this.dopplerSensitivity;
  }

  public setDopplerSensitivity(sensitivity: number): void {
    const clamped = Math.max(0, Math.min(3, Number.isFinite(sensitivity) ? sensitivity : 1.0));
    this.dopplerSensitivity = clamped;
    this.lastDopplerStepKey = null;
  }

  /**
   * Computes and caches EMA-smoothed Doppler telemetry for all four cardinal layers,
   * deduplicating by (dateStr, cadenceMs, dopplerSensitivity) so repeated UI/audio
   * queries within the same observation tick do not double-advance the filter.
   */
  public computeFilteredDopplerMap(
    vectors: Record<LayerKey, FeatureVector>,
    cadenceMs: number,
    dateStr?: string
  ): Record<LayerKey, DopplerShiftTelemetry> {
    this.latestVectors = vectors;
    this.commitMotionFrame(vectors, dateStr);
    const stepKey = `${dateStr ?? this.lastMotionFrameDate ?? 'live'}:${Math.round(
      cadenceMs
    )}:${this.dopplerSensitivity.toFixed(2)}`;
    if (stepKey === this.lastDopplerStepKey && this.smoothedDopplerMultiplier.north !== undefined) {
      return this.lastDopplerByLayer;
    }

    const nextMap = {} as Record<LayerKey, DopplerShiftTelemetry>;
    for (const key of LAYER_ORDER) {
      const filtered = AudioEngine.computeDopplerShift(
        vectors[key].motion,
        cadenceMs,
        this.prevMotionByLayer[key],
        this.smoothedDopplerMultiplier[key],
        AudioEngine.DOPPLER_EMA_ALPHA,
        this.dopplerSensitivity
      );
      this.smoothedDopplerMultiplier[key] = filtered.multiplier;
      nextMap[key] = filtered;
    }

    this.lastDopplerByLayer = nextMap;
    this.lastDopplerStepKey = stepKey;
    return this.lastDopplerByLayer;
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

  public getMagneticSnapEnabled(): boolean {
    return this.magneticSnapEnabled;
  }

  public setMagneticSnapEnabled(enabled: boolean): void {
    this.magneticSnapEnabled = enabled;
    if (!enabled) {
      this.lastMagneticDetentKey = null;
      return;
    }
    if (this.latestVectors) {
      this.setHeading(this.activeHeading, 0.16);
    }
  }

  public setLatestVectors(vectors: Record<LayerKey, FeatureVector>): void {
    this.latestVectors = vectors;
  }

  /**
   * Finds the nearest high-intensity climate anomaly layer azimuth (or next/previous
   * high-anomaly sector when directionStepHint is supplied) so Magnetic Snap aligns
   * listener heading cleanly with active planetary anomaly centers.
   */
  public resolveMagneticSnap(
    rawHeadingDeg: number,
    vectors: Record<LayerKey, FeatureVector>,
    directionStepHint?: -1 | 1
  ): {
    snappedAngle: number;
    targetKey: LayerKey;
    anomalyIntensity: number;
  } {
    const normalized = ((rawHeadingDeg % 360) + 360) % 360;
    const allEntries = LAYER_ORDER.map((key) => ({
      key,
      azimuth: NASA_GIBS_LAYERS[key].azimuth,
      anomaly: vectors[key]?.climateAnomaly ?? 0,
    }));

    const highAnomalies = allEntries.filter(
      (item) => item.anomaly >= AudioEngine.MAGNETIC_ANOMALY_THRESHOLD
    );
    const candidates =
      highAnomalies.length > 0
        ? highAnomalies
        : [...allEntries].sort((a, b) => b.anomaly - a.anomaly).slice(0, 2);

    if (directionStepHint && candidates.length > 1) {
      const sorted = candidates
        .map((c) => {
          const forwardDelta = (((c.azimuth - normalized) % 360) + 360) % 360;
          const signedStep =
            directionStepHint > 0
              ? forwardDelta === 0
                ? 360
                : forwardDelta
              : forwardDelta === 0
              ? 360
              : 360 - forwardDelta;
          return { ...c, signedStep };
        })
        .sort((a, b) => a.signedStep - b.signedStep);
      const chosen = sorted[0];
      return {
        snappedAngle: chosen.azimuth,
        targetKey: chosen.key,
        anomalyIntensity: chosen.anomaly,
      };
    }

    let best = candidates[0];
    let bestDist = Infinity;
    for (const c of candidates) {
      const rawDiff = Math.abs(normalized - c.azimuth);
      const angularDist = Math.min(rawDiff, 360 - rawDiff);
      if (
        angularDist < bestDist - 0.5 ||
        (Math.abs(angularDist - bestDist) <= 0.5 && c.anomaly > best.anomaly)
      ) {
        best = c;
        bestDist = angularDist;
      }
    }

    return {
      snappedAngle: best.azimuth,
      targetKey: best.key,
      anomalyIntensity: best.anomaly,
    };
  }

  /**
   * Plays a crisp 42ms tactile haptic-like magnetic detent pulse (sub-bass thump +
   * dry mechanical click) when crossing or locking onto an anomaly center.
   */
  public triggerMagneticDetentHaptic(anomalyIntensity = 0.65): void {
    if (!this.ctx || this.ctx.state !== 'running' || !this.compressor) return;
    const nowMs = Date.now();
    if (nowMs - this.lastMagneticDetentMs < 110) return;
    this.lastMagneticDetentMs = nowMs;

    const now = this.ctx.currentTime;
    const clampedIntensity = Math.max(0.2, Math.min(1, anomalyIntensity));

    // 1. Sub-bass LRA-style tactile thump (140Hz -> 48Hz over 40ms)
    const thumpOsc = this.ctx.createOscillator();
    thumpOsc.type = 'sine';
    thumpOsc.frequency.setValueAtTime(142, now);
    thumpOsc.frequency.exponentialRampToValueAtTime(48, now + 0.04);

    const thumpGain = this.ctx.createGain();
    const thumpPeak = 0.24 + clampedIntensity * 0.22;
    thumpGain.gain.setValueAtTime(0.0001, now);
    thumpGain.gain.linearRampToValueAtTime(thumpPeak, now + 0.002);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.044);

    thumpOsc.connect(thumpGain);
    thumpGain.connect(this.compressor);
    thumpOsc.start(now);
    thumpOsc.stop(now + 0.05);
    thumpOsc.onended = () => {
      thumpOsc.disconnect();
      thumpGain.disconnect();
    };

    // 2. Crisp mechanical magnetic lock micro-click (980Hz -> 420Hz bandpass)
    const clickOsc = this.ctx.createOscillator();
    clickOsc.type = 'triangle';
    clickOsc.frequency.setValueAtTime(980, now);
    clickOsc.frequency.exponentialRampToValueAtTime(420, now + 0.015);

    const clickBp = this.ctx.createBiquadFilter();
    clickBp.type = 'bandpass';
    clickBp.frequency.setValueAtTime(860, now);
    clickBp.Q.setValueAtTime(3.6, now);

    const clickGain = this.ctx.createGain();
    clickGain.gain.setValueAtTime(0.0001, now);
    clickGain.gain.linearRampToValueAtTime(0.14 + clampedIntensity * 0.1, now + 0.0015);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);

    clickOsc.connect(clickBp);
    clickBp.connect(clickGain);
    clickGain.connect(this.compressor);
    clickOsc.start(now);
    clickOsc.stop(now + 0.024);
    clickOsc.onended = () => {
      clickOsc.disconnect();
      clickBp.disconnect();
      clickGain.disconnect();
    };
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

  public getWindTurbulenceMultiplier(): number {
    return this.windTurbulenceMultiplier;
  }

  public setWindTurbulenceMultiplier(multiplier: number): void {
    const clamped = Math.max(0, Math.min(2.5, Number.isFinite(multiplier) ? multiplier : 1.0));
    this.windTurbulenceMultiplier = clamped;
    this.atmosphericFlow?.setTurbulenceMultiplier(clamped);
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

      this.narrationDuckGain = this.ctx.createGain();
      this.narrationDuckGain.gain.setValueAtTime(
        this.isNarrationActive ? 0.35 : 1.0,
        this.ctx.currentTime
      );

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

      this.compressor.connect(this.narrationDuckGain);
      this.narrationDuckGain.connect(this.analyser);
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
      this.atmosphericFlow.setTurbulenceMultiplier(this.windTurbulenceMultiplier);
      this.solarChime = new SolarChimeSynth(this.ctx, this.spatialBus);
      this.solarFlareSynth = new SolarFlareSynth(this.ctx, this.compressor);
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.setHeading(this.activeHeading, 0.02);
    return this.ctx;
  }

  public getOutputAudioNodes(): { context: AudioContext | null; gainNode: GainNode | null } {
    return {
      context: this.ctx,
      gainNode: this.narrationDuckGain,
    };
  }

  public async start(): Promise<void> {
    await this.initOnUserGesture();
    if (!this.synths) return;
    if (this.ctx && this.narrationDuckGain) {
      const now = this.ctx.currentTime;
      this.narrationDuckGain.gain.cancelScheduledValues(now);
      this.narrationDuckGain.gain.setTargetAtTime(
        this.isNarrationActive ? 0.35 : 1.0,
        now,
        0.06
      );
    }
    for (const key of LAYER_ORDER) {
      this.synths[key].start();
    }
    this.atmosphericFlow?.setEnabled(this.atmosphericFlowEnabled);
    this.atmosphericFlow?.setTurbulenceMultiplier(this.windTurbulenceMultiplier);
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

  public setNarrationActive(active: boolean, recoveryDelaySec = 0): void {
    this.isNarrationActive = active;
    if (this.ctx && this.narrationDuckGain) {
      const now = this.ctx.currentTime;
      const gainParam = this.narrationDuckGain.gain;

      if (active) {
        if (typeof gainParam.cancelAndHoldAtTime === 'function') {
          gainParam.cancelAndHoldAtTime(now);
        } else {
          gainParam.cancelScheduledValues(now);
        }
        gainParam.setTargetAtTime(0.35, now, 0.09);
        return;
      }

      if (recoveryDelaySec > 0) {
        // Allow post-speech 100ms exponential decay ramp to complete before gently restoring running stream
        if (this.isAudioRunning) {
          gainParam.setTargetAtTime(1.0, now + recoveryDelaySec, 0.35);
        }
      } else {
        if (typeof gainParam.cancelAndHoldAtTime === 'function') {
          gainParam.cancelAndHoldAtTime(now);
        } else {
          gainParam.cancelScheduledValues(now);
        }
        if (this.isAudioRunning) {
          gainParam.setTargetAtTime(1.0, now, 0.35);
        }
      }
    }
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
    const normalizedInput = ((headingDegrees % 360) + 360) % 360;
    let resolvedHeading = normalizedInput;

    if (this.magneticSnapEnabled && this.latestVectors) {
      const snap = this.resolveMagneticSnap(normalizedInput, this.latestVectors);
      resolvedHeading = snap.snappedAngle;
      if (snap.targetKey !== this.lastMagneticDetentKey) {
        this.lastMagneticDetentKey = snap.targetKey;
        this.triggerMagneticDetentHaptic(snap.anomalyIntensity);
      }
    } else if (this.latestVectors && this.prevHeadingForAnomalyCross !== null) {
      // Detect crossing the exact center azimuth of a high-intensity anomaly region
      const prevAngle = this.prevHeadingForAnomalyCross;
      for (const key of LAYER_ORDER) {
        const anomaly = this.latestVectors[key]?.climateAnomaly ?? 0;
        if (anomaly < AudioEngine.MAGNETIC_ANOMALY_THRESHOLD) continue;
        const centerAz = NASA_GIBS_LAYERS[key].azimuth;
        const prevSigned = ((prevAngle - centerAz + 540) % 360) - 180;
        const currSigned = ((normalizedInput - centerAz + 540) % 360) - 180;
        if (
          Math.abs(prevSigned) <= 25 &&
          Math.abs(currSigned) <= 25 &&
          ((prevSigned < 0 && currSigned >= 0) ||
            (prevSigned > 0 && currSigned <= 0) ||
            (Math.abs(currSigned) < 0.8 && Math.abs(prevSigned) >= 0.8))
        ) {
          this.triggerMagneticDetentHaptic(anomaly);
          break;
        }
      }
    }

    this.prevHeadingForAnomalyCross = resolvedHeading;
    this.activeHeading = resolvedHeading;
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
    const dopplers = this.computeFilteredDopplerMap(vectors, cadenceMs, dateStr);
    if (!dateStr.startsWith('2007-')) return [];

    const timestamp = new Date().toISOString().slice(11, 19);
    const detected: AudioEventEntry[] = [];

    for (const key of LAYER_ORDER) {
      const vec = vectors[key];
      const meta = NASA_GIBS_LAYERS[key];
      const doppler = dopplers[key];
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
        const signedPct = `${doppler.shiftPct >= 0 ? '+' : ''}${doppler.shiftPct.toFixed(1)}%`;
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
          ).toFixed(1)}% VELOCITY → DOPPLER ${signedPct} (${frequencyHz} HZ)`,
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
    const dopplers = this.computeFilteredDopplerMap(vectors, cadenceMs, dateStr);
    const freqs: Record<LayerKey, number> = {
      north: 0,
      east: 0,
      south: 0,
      west: 0,
    };

    for (const key of LAYER_ORDER) {
      const doppler = dopplers[key];
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

  /**
   * Monitors real-time/archive solar activity telemetry and triggers a glitchy
   * metallic auroral chime when auroral potential exceeds threshold.
   */
  public evaluateSolarActivity(
    telemetry: SolarActivityTelemetry,
    dateStr: string,
    forceTrigger = false,
    referenceLayerFreqHz = 220
  ): AudioEventEntry | null {
    const nowMs = Date.now();
    const crossedThreshold =
      telemetry.intensity >= AudioEngine.SOLAR_ACTIVITY_THRESHOLD &&
      (this.prevSolarIntensity < AudioEngine.SOLAR_ACTIVITY_THRESHOLD ||
        telemetry.intensity - this.prevSolarIntensity >= 0.05 ||
        nowMs - this.lastSolarTriggerMs >= 14_000);

    this.prevSolarIntensity = telemetry.intensity;

    if (!forceTrigger && !crossedThreshold) {
      return null;
    }
    if (!forceTrigger && nowMs - this.lastSolarTriggerMs < 8_000) {
      return null;
    }

    this.lastSolarTriggerMs = nowMs;
    const playIntensity = forceTrigger ? Math.max(0.84, telemetry.intensity) : telemetry.intensity;
    const chimeHz =
      this.solarChime && (this.isAudioRunning || forceTrigger)
        ? this.solarChime.triggerAuroralChime(playIntensity)
        : 587;

    const kp = telemetry.kpIndex;
    const stormScale =
      kp >= 8
        ? 'G4 SEVERE'
        : kp >= 7
        ? 'G3 STRONG'
        : kp >= 6
        ? 'G2 MODERATE'
        : kp >= 5
        ? 'G1 MINOR'
        : 'SUB-STORM SURGE';
    const baseHz = Math.max(98, Math.round(referenceLayerFreqHz || 220));
    const impactRatio = 1 + Math.max(0.012, (playIntensity - 0.45) * 0.065);
    const freqDeltaHz = Math.max(2, Math.round(baseHz * (impactRatio - 1)));
    const peakOvertoneHz = Math.round(chimeHz * 3.17);

    let peakAnomalyKey: LayerKey = 'north';
    if (this.latestVectors) {
      let bestVal = -1;
      for (const k of LAYER_ORDER) {
        const val = this.latestVectors[k]?.climateAnomaly ?? 0;
        if (val > bestVal) {
          bestVal = val;
          peakAnomalyKey = k;
        }
      }
    }

    const timestamp = new Date().toISOString().slice(11, 19);
    const entry: AudioEventEntry = {
      id: `evt-solar-${dateStr}-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp,
      dateStr,
      layerKey: peakAnomalyKey,
      kind: 'solar_activity',
      value: playIntensity,
      threshold: AudioEngine.SOLAR_ACTIVITY_THRESHOLD,
      frequencyHz: chimeHz,
      message: `SOLAR STORM (${stormScale}) · KP ${kp.toFixed(1)} · WIND ${
        telemetry.solarWindKms
      } KM/S · AURORA ${Math.round(playIntensity * 100)}% → FREQ IMPACT +${freqDeltaHz} HZ (${baseHz}→${
        baseHz + freqDeltaHz
      } HZ) · CHIME ${chimeHz}–${peakOvertoneHz} HZ`,
    };
    this.audioEventListener?.(entry);
    return entry;
  }

  public async triggerSolarAuroraPing(
    telemetry: SolarActivityTelemetry,
    dateStr: string,
    referenceLayerFreqHz = 220
  ): Promise<AudioEventEntry | null> {
    await this.initOnUserGesture();
    return this.evaluateSolarActivity(telemetry, dateStr, true, referenceLayerFreqHz);
  }

  /**
   * Monitors solar wind telemetry for extreme speed spikes (>= 680 km/s or sudden +95 km/s surge)
   * and fires a brief, high-intensity filtered white-noise burst with a sharp frequency sweep.
   */
  public evaluateSolarWindFlare(
    telemetry: SolarActivityTelemetry,
    dateStr: string,
    forceTrigger = false
  ): AudioEventEntry | null {
    const nowMs = Date.now();
    const windKms = telemetry.solarWindKms;
    const deltaKms = this.prevSolarWindKms !== null ? windKms - this.prevSolarWindKms : 0;

    const isExtremeSpeed = windKms >= AudioEngine.SOLAR_WIND_FLARE_THRESHOLD_KMS;
    const isSuddenJump = deltaKms >= AudioEngine.SOLAR_WIND_SPIKE_DELTA_KMS && windKms >= 590;
    const crossedThreshold =
      (isExtremeSpeed &&
        (this.prevSolarWindKms === null ||
          this.prevSolarWindKms < AudioEngine.SOLAR_WIND_FLARE_THRESHOLD_KMS ||
          nowMs - this.lastSolarFlareMs >= 16_000)) ||
      isSuddenJump;

    this.prevSolarWindKms = windKms;

    if (!forceTrigger && !crossedThreshold) {
      return null;
    }
    if (!forceTrigger && nowMs - this.lastSolarFlareMs < 10_000) {
      return null;
    }

    this.lastSolarFlareMs = nowMs;
    const rawIntensity = Math.min(1, Math.max(0.65, (windKms - 450) / 400));
    const flareIntensity = forceTrigger ? Math.max(0.88, rawIntensity) : rawIntensity;

    const sweep =
      this.solarFlareSynth && (this.isAudioRunning || forceTrigger)
        ? this.solarFlareSynth.triggerSolarFlareBurst(flareIntensity)
        : { startHz: Math.round(7200 + flareIntensity * 2200), endHz: 260 };

    let peakAnomalyKey: LayerKey = 'north';
    if (this.latestVectors) {
      let bestVal = -1;
      for (const k of LAYER_ORDER) {
        const val = this.latestVectors[k]?.climateAnomaly ?? 0;
        if (val > bestVal) {
          bestVal = val;
          peakAnomalyKey = k;
        }
      }
    }

    const timestamp = new Date().toISOString().slice(11, 19);
    const entry: AudioEventEntry = {
      id: `evt-flare-${dateStr}-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp,
      dateStr,
      layerKey: peakAnomalyKey,
      kind: 'solar_flare',
      value: windKms,
      threshold: AudioEngine.SOLAR_WIND_FLARE_THRESHOLD_KMS,
      frequencyHz: sweep.startHz,
      message: `SOLAR FLARE · WIND SPIKE ${windKms} KM/S${
        deltaKms > 0 ? ` (+${Math.round(deltaKms)} KM/S)` : ''
      } · KP ${telemetry.kpIndex.toFixed(1)} · NOISE SWEEP ${sweep.startHz}→${sweep.endHz} HZ`,
    };
    this.audioEventListener?.(entry);
    return entry;
  }

  public async triggerSolarFlarePing(
    telemetry: SolarActivityTelemetry,
    dateStr: string
  ): Promise<AudioEventEntry | null> {
    await this.initOnUserGesture();
    return this.evaluateSolarWindFlare(telemetry, dateStr, true);
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
    this.solarChime = null;
    this.solarFlareSynth = null;
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
    this.narrationDuckGain?.disconnect();
    this.analyser?.disconnect();
    this.masterGain?.disconnect();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
