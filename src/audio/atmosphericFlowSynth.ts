import { HeadingWindTelemetry } from '../analysis/windVectorField';

/**
 * Generates a deterministic 4-second stereo pink-weighted aerodynamic noise buffer
 * for zero-click granular sampling and continuous sub-air floor synthesis.
 */
function createAerodynamicNoiseBuffer(ctx: AudioContext, durationSec = 4.0): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * durationSec));
  const buffer = ctx.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let seed = ch === 0 ? 0x6c078965 : 0x5d588b65;
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;

    for (let i = 0; i < length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const white = (seed / 0xffffffff) * 2 - 1;

      // Paul Kellet / multi-pole pink noise shaping for natural wind timbre
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      const pink = (b0 + b1 + b2 + white * 0.1848) * 0.22;
      b3 = b3 * 0.85 + pink * 0.15;

      // Crossfade loop seam in the final 40ms
      const fadeSamples = Math.floor(sampleRate * 0.04);
      let env = 1;
      if (i < fadeSamples) env = i / fadeSamples;
      else if (i > length - fadeSamples) env = (length - i) / fadeSamples;

      data[i] = Math.max(-1, Math.min(1, (pink * 0.72 + b3 * 0.28) * env));
    }
  }

  return buffer;
}

/**
 * Granular Synthesis Noise-Floor for the "Atmospheric Flow" layer:
 * - Maps real-time NASA GIBS wind vectors + heading oceanic exposure into:
 *   1) Continuous filtered sub-air ocean-swell noise bed
 *   2) Asynchronous overlapping bandpass micro-grains whose emission density,
 *      formant frequency, stereo gust spread, and intensity increase cleanly
 *      as the user's heading sweeps across high-wind oceanic zones.
 */
export class AtmosphericFlowSynth {
  private ctx: AudioContext;
  private noiseBuffer: AudioBuffer;
  private masterGain: GainNode;
  private bedSource: AudioBufferSourceNode | null = null;
  private bedFilter: BiquadFilterNode;
  private bedGain: GainNode;
  private schedulerId: number | null = null;

  private isStarted = false;
  private isEnabled = true;
  private turbulenceMultiplier = 1.0;
  private currentIntensity = 0.28;
  private currentOceanic = 0.65;
  private currentTurbulence = 0.35;
  private currentRelativeBearingRad = 0;
  private grainSeq = 0;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.noiseBuffer = createAerodynamicNoiseBuffer(ctx, 4.0);

    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.0, ctx.currentTime);
    this.masterGain.connect(destination);

    this.bedFilter = ctx.createBiquadFilter();
    this.bedFilter.type = 'lowpass';
    this.bedFilter.frequency.setValueAtTime(340, ctx.currentTime);
    this.bedFilter.Q.setValueAtTime(0.9, ctx.currentTime);

    this.bedGain = ctx.createGain();
    this.bedGain.gain.setValueAtTime(0.18, ctx.currentTime);

    this.bedFilter.connect(this.bedGain);
    this.bedGain.connect(this.masterGain);
  }

  public isActive(): boolean {
    return this.isEnabled && this.isStarted;
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.applyOutputGain();
    if (this.isStarted) {
      if (enabled && this.schedulerId === null) {
        this.startGrainScheduler();
      } else if (!enabled && this.schedulerId !== null) {
        window.clearInterval(this.schedulerId);
        this.schedulerId = null;
      }
    }
  }

  public getTurbulenceMultiplier(): number {
    return this.turbulenceMultiplier;
  }

  public setTurbulenceMultiplier(multiplier: number): void {
    const clamped = Math.max(0, Math.min(2.5, Number.isFinite(multiplier) ? multiplier : 1.0));
    this.turbulenceMultiplier = clamped;
    const effectiveTurb = Math.min(1.6, this.currentTurbulence * Math.max(0.25, clamped));
    this.bedFilter.Q.setTargetAtTime(0.8 + effectiveTurb * 1.4, this.ctx.currentTime, 0.08);
    this.applyOutputGain();
  }

  public start(): void {
    if (this.isStarted) return;
    this.isStarted = true;

    const now = this.ctx.currentTime;
    const bed = this.ctx.createBufferSource();
    bed.buffer = this.noiseBuffer;
    bed.loop = true;
    bed.playbackRate.setValueAtTime(0.85, now);
    bed.connect(this.bedFilter);
    bed.start(now);
    this.bedSource = bed;

    this.applyOutputGain();
    if (this.isEnabled) {
      this.startGrainScheduler();
    }
  }

  public stop(): void {
    this.isStarted = false;
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId);
      this.schedulerId = null;
    }

    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(0.0, now, 0.06);

    if (this.bedSource) {
      const old = this.bedSource;
      this.bedSource = null;
      window.setTimeout(() => {
        try {
          old.stop();
          old.disconnect();
        } catch {
          // Ignore already stopped source
        }
      }, 220);
    }
  }

  public updateFromWind(telemetry: HeadingWindTelemetry, listenerHeadingDeg: number): void {
    this.currentIntensity = telemetry.intensity;
    this.currentOceanic = telemetry.oceanicFactor;
    this.currentTurbulence = telemetry.turbulence;
    this.currentRelativeBearingRad = ((telemetry.bearingDeg - listenerHeadingDeg) * Math.PI) / 180;

    const now = this.ctx.currentTime;
    const effectiveTurb = Math.min(
      1.6,
      telemetry.turbulence * Math.max(0.25, this.turbulenceMultiplier)
    );
    // Open the sub-air swell cutoff from deep 240Hz rumble up to airy 1150Hz oceanic roar
    const bedCutoff = 240 + telemetry.intensity * 920;
    this.bedFilter.frequency.setTargetAtTime(bedCutoff, now, 0.12);
    this.bedFilter.Q.setTargetAtTime(0.8 + effectiveTurb * 1.4, now, 0.12);

    this.applyOutputGain();
  }

  private applyOutputGain(): void {
    const now = this.ctx.currentTime;
    if (!this.isStarted || !this.isEnabled || this.turbulenceMultiplier <= 0.005) {
      this.masterGain.gain.setTargetAtTime(0.0, now, 0.08);
      return;
    }

    // Quiet baseline air floor (0.045) swells cleanly to rich wind floor (~0.36) in high-wind ocean zones,
    // scaled independently by the user's Wind Turbulence multiplier [0.0..2.5]
    const baseTarget =
      0.045 + this.currentIntensity * 0.315 * (0.45 + 0.55 * this.currentOceanic);
    const target = Math.min(0.95, baseTarget * this.turbulenceMultiplier);
    this.masterGain.gain.setTargetAtTime(target, now, 0.08);
  }

  private startGrainScheduler(): void {
    if (this.schedulerId !== null) {
      window.clearInterval(this.schedulerId);
    }
    this.schedulerId = window.setInterval(() => {
      this.emitGrainCluster();
    }, 52);
  }

  private emitGrainCluster(): void {
    if (
      !this.isStarted ||
      !this.isEnabled ||
      this.turbulenceMultiplier <= 0.01 ||
      this.ctx.state !== 'running'
    ) {
      return;
    }

    const mult = this.turbulenceMultiplier;
    const effectiveIntensity = Math.min(1.5, this.currentIntensity * (0.45 + 0.55 * mult));
    const effectiveTurbulence = Math.min(1.6, this.currentTurbulence * Math.max(0.25, mult));

    // 1 grain in calm zones; 2-4 overlapping wind-shear grains when turbulence emphasizes high-wind corridors
    const grainCount =
      effectiveIntensity > 0.95
        ? 4
        : effectiveIntensity > 0.65
        ? 3
        : effectiveIntensity > 0.3
        ? 2
        : 1;

    for (let g = 0; g < grainCount; g++) {
      this.grainSeq = (this.grainSeq + 1) >>> 0;
      const r1 = ((this.grainSeq * 2654435761) >>> 0) / 0xffffffff;
      const r2 = (((this.grainSeq + 17) * 2246822519) >>> 0) / 0xffffffff;
      const r3 = (((this.grainSeq + 53) * 3266489917) >>> 0) / 0xffffffff;

      const now = this.ctx.currentTime + g * 0.016 + r1 * 0.012;
      const duration = 0.21 - this.currentIntensity * 0.095 + r2 * 0.05;
      const offsetMax = Math.max(0.2, this.noiseBuffer.duration - duration - 0.1);
      const offset = r3 * offsetMax;

      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.playbackRate.setValueAtTime(
        0.74 + this.currentIntensity * 0.52 + (r1 - 0.5) * 0.24,
        now
      );

      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      const formantHz =
        220 + this.currentIntensity * 1020 + (r2 - 0.5) * (180 + effectiveTurbulence * 420);
      bp.frequency.setValueAtTime(Math.max(150, Math.min(1750, formantHz)), now);
      bp.Q.setValueAtTime(0.9 + effectiveTurbulence * 1.1, now);

      const env = this.ctx.createGain();
      const peakAmp = Math.min(
        0.46,
        (0.1 + this.currentIntensity * 0.2) * Math.max(0.15, Math.min(2.0, mult))
      );
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(peakAmp, now + duration * 0.42);
      env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      const panner = this.ctx.createStereoPanner();
      const windPan = Math.sin(this.currentRelativeBearingRad) * 0.62;
      const scatter = (r1 - 0.5) * (0.45 + effectiveTurbulence * 0.5);
      panner.pan.setValueAtTime(Math.max(-0.95, Math.min(0.95, windPan + scatter)), now);

      src.connect(bp);
      bp.connect(env);
      env.connect(panner);
      panner.connect(this.masterGain);

      src.start(now, offset, duration + 0.02);
      src.onended = () => {
        src.disconnect();
        bp.disconnect();
        env.disconnect();
        panner.disconnect();
      };
    }
  }

  public dispose(): void {
    this.stop();
    this.bedFilter.disconnect();
    this.bedGain.disconnect();
    this.masterGain.disconnect();
  }
}
