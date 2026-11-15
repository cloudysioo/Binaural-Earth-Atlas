import { FeatureVector, LayerKey, NASA_GIBS_LAYERS } from '../types/bea';
import { quantizeToPentatonic, ScaleMode } from './scales';

/**
 * Independent synthesis voice for each cardinal Earth observation layer:
 * [Osc1: Fundamental] + [Osc2: Dissonance] -> [BiquadFilter (Lowpass)] -> [GainNode (Envelope)] -> [Focus Gain] -> [HRTF Panner]
 */
export class LayerSynth {
  private ctx: AudioContext;
  private osc1: OscillatorNode;
  private osc2: OscillatorNode;
  private osc2Gain: GainNode;
  private filter: BiquadFilterNode;
  private envelopeGain: GainNode;
  private focusGain: GainNode;
  private isStarted = false;
  private currentFreq = 220;

  constructor(ctx: AudioContext, layerKey: LayerKey, panner: PannerNode) {
    this.ctx = ctx;
    const meta = NASA_GIBS_LAYERS[layerKey];

    this.osc1 = ctx.createOscillator();
    this.osc1.type = meta.waveform;
    this.osc1.frequency.setValueAtTime(220, ctx.currentTime);

    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'sawtooth';
    this.osc2.frequency.setValueAtTime(220, ctx.currentTime);

    this.osc2Gain = ctx.createGain();
    this.osc2Gain.gain.setValueAtTime(0.0, ctx.currentTime);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.setValueAtTime(1200, ctx.currentTime);
    this.filter.Q.setValueAtTime(2.4, ctx.currentTime);

    this.envelopeGain = ctx.createGain();
    this.envelopeGain.gain.setValueAtTime(0.0, ctx.currentTime);

    this.focusGain = ctx.createGain();
    this.focusGain.gain.setValueAtTime(0.55, ctx.currentTime);

    this.osc1.connect(this.filter);
    this.osc2.connect(this.osc2Gain);
    this.osc2Gain.connect(this.filter);

    this.filter.connect(this.envelopeGain);
    this.envelopeGain.connect(this.focusGain);
    this.focusGain.connect(panner);
  }

  public start(): void {
    if (this.isStarted) return;
    const now = this.ctx.currentTime;
    this.osc1.start(now);
    this.osc2.start(now);
    this.isStarted = true;
  }

  public stop(): void {
    const now = this.ctx.currentTime;
    this.envelopeGain.gain.cancelScheduledValues(now);
    this.envelopeGain.gain.setTargetAtTime(0.0, now, 0.04);
  }

  public dispose(): void {
    if (this.isStarted) {
      try {
        this.osc1.stop();
        this.osc2.stop();
      } catch {
        // Ignore already stopped oscillators
      }
    }
    this.osc1.disconnect();
    this.osc2.disconnect();
    this.osc2Gain.disconnect();
    this.filter.disconnect();
    this.envelopeGain.disconnect();
    this.focusGain.disconnect();
  }

  /**
   * Smoothly scales focus emphasis across a continuous 360-degree heading using
   * a 500ms exponential crossfade (1.00x directly ahead, 0.45x behind).
   */
  public setAngularFocus(angularDeltaDeg: number, crossfadeDurationSec = 0.5): void {
    const rad = (angularDeltaDeg * Math.PI) / 180;
    const forwardAlignment = Math.max(0, Math.cos(rad));
    const target = Math.max(0.001, 0.45 + 0.55 * forwardAlignment);
    const duration = Math.max(0.01, crossfadeDurationSec);

    const now = this.ctx.currentTime;
    const gainParam = this.focusGain.gain;

    if (typeof gainParam.cancelAndHoldAtTime === 'function') {
      gainParam.cancelAndHoldAtTime(now);
      if (gainParam.value <= 0.001) {
        gainParam.setValueAtTime(0.001, now);
      }
    } else {
      gainParam.cancelScheduledValues(now);
      gainParam.setValueAtTime(Math.max(0.001, gainParam.value), now);
    }

    gainParam.exponentialRampToValueAtTime(target, now + duration);
  }

  /**
   * Continuously tracks focus emphasis at animation-frame cadence during Full 360°
   * Smooth Panning without restarting discrete ramp envelopes on every degree step.
   */
  public setContinuousAngularFocus(angularDeltaDeg: number, timeConstantSec = 0.025): void {
    const rad = (angularDeltaDeg * Math.PI) / 180;
    const forwardAlignment = Math.max(0, Math.cos(rad));
    const target = Math.max(0.001, 0.45 + 0.55 * forwardAlignment);
    const now = this.ctx.currentTime;
    const gainParam = this.focusGain.gain;
    gainParam.setTargetAtTime(target, now, Math.max(0.008, timeConstantSec));
  }

  public updateFromFeatures(
    features: FeatureVector,
    cadenceMs: number,
    scaleMode: ScaleMode = 'pentatonic',
    dopplerMultiplier = 1.0
  ): number {
    const now = this.ctx.currentTime;
    const { frequency } = quantizeToPentatonic(features.hue, features.brightness, scaleMode);
    const clampedDoppler = Math.max(0.8, Math.min(1.5, dopplerMultiplier));
    const shiftedFrequency = frequency * clampedDoppler;
    this.currentFreq = shiftedFrequency;

    this.osc1.frequency.setTargetAtTime(shiftedFrequency, now, 0.06);

    const detuneRatio = 1 + 0.015 + features.climateAnomaly * 0.085;
    this.osc2.frequency.setTargetAtTime(shiftedFrequency * detuneRatio, now, 0.06);
    this.osc2Gain.gain.setTargetAtTime(features.climateAnomaly * 0.28, now, 0.08);

    const cutoff = 400 + features.saturation * 5600;
    this.filter.frequency.setTargetAtTime(cutoff, now, 0.08);

    const baseSustained = 0.085 + features.brightness * 0.06;
    const pulsePeak = Math.min(0.28, baseSustained + 0.09 + features.edgeDensity * 0.1);
    const subdivisions = features.edgeDensity > 0.65 ? 3 : features.edgeDensity > 0.35 ? 2 : 1;
    const stepSec = Math.max(0.8, cadenceMs / 1000);
    const subInterval = stepSec / subdivisions;

    this.envelopeGain.gain.cancelScheduledValues(now);
    for (let i = 0; i < subdivisions; i++) {
      const t = now + i * subInterval;
      this.envelopeGain.gain.setValueAtTime(baseSustained, t);
      this.envelopeGain.gain.linearRampToValueAtTime(pulsePeak, t + 0.04);
      this.envelopeGain.gain.setTargetAtTime(
        baseSustained,
        t + 0.06,
        Math.max(0.08, subInterval * 0.35)
      );
    }

    return this.currentFreq;
  }

  public triggerCalibrationPing(durationSec = 0.45): void {
    const now = this.ctx.currentTime;
    this.osc1.frequency.setTargetAtTime(this.currentFreq || 440, now, 0.01);
    this.filter.frequency.setTargetAtTime(3400, now, 0.01);
    this.focusGain.gain.setTargetAtTime(1.0, now, 0.01);

    this.envelopeGain.gain.cancelScheduledValues(now);
    this.envelopeGain.gain.setValueAtTime(0.0, now);
    this.envelopeGain.gain.linearRampToValueAtTime(0.32, now + 0.03);
    this.envelopeGain.gain.setTargetAtTime(0.0, now + durationSec * 0.65, 0.08);
  }
}
