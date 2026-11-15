/**
 * Solar Flare White-Noise Burst & Frequency Sweep Synthesizer:
 * Triggers a brief, high-intensity filtered white-noise plasma transient with a
 * sharp downward resonant frequency sweep (8400 Hz -> 260 Hz) when extreme spikes
 * in solar wind telemetry are detected — sonically distinct from the tonal FM
 * auroral chime cascade.
 */
export class SolarFlareSynth {
  private ctx: AudioContext;
  private destination: AudioNode;
  private noiseBuffer: AudioBuffer;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.destination = destination;
    this.noiseBuffer = this.createWhiteNoiseBuffer(0.45);
  }

  private createWhiteNoiseBuffer(durationSec: number): AudioBuffer {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * durationSec));
    const buffer = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const channel = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        channel[i] = Math.random() * 2 - 1;
      }
    }
    return buffer;
  }

  /**
   * Fires a brief (~0.36s) high-intensity white-noise burst with a sharp downward
   * resonant frequency sweep. Returns the sweep start frequency in Hz.
   */
  public triggerSolarFlareBurst(intensity = 0.9): { startHz: number; endHz: number } {
    const clamped = Math.max(0.4, Math.min(1, Number.isFinite(intensity) ? intensity : 0.9));
    const startHz = Math.round(7200 + clamped * 2200); // ~8100 - 9400 Hz
    const endHz = 260;

    if (this.ctx.state !== 'running') {
      return { startHz, endHz };
    }

    const now = this.ctx.currentTime;
    const burstDur = 0.36;

    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;

    // Sharp resonant bandpass sweep from upper X-ray crackle down into sub-ionospheric thump
    const sweepFilter = this.ctx.createBiquadFilter();
    sweepFilter.type = 'bandpass';
    sweepFilter.Q.setValueAtTime(5.2 + clamped * 2.4, now);
    sweepFilter.frequency.setValueAtTime(startHz, now);
    sweepFilter.frequency.exponentialRampToValueAtTime(endHz, now + 0.31);

    // Secondary steep lowpass sizzle guard to keep sweep razor-focused
    const edgeFilter = this.ctx.createBiquadFilter();
    edgeFilter.type = 'lowpass';
    edgeFilter.Q.setValueAtTime(2.8, now);
    edgeFilter.frequency.setValueAtTime(Math.min(12000, startHz * 1.35), now);
    edgeFilter.frequency.exponentialRampToValueAtTime(480, now + burstDur);

    const env = this.ctx.createGain();
    const peakGain = 0.42 + clamped * 0.32;
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(peakGain, now + 0.004);
    env.gain.exponentialRampToValueAtTime(peakGain * 0.35, now + 0.14);
    env.gain.exponentialRampToValueAtTime(0.0001, now + burstDur);

    source.connect(sweepFilter);
    sweepFilter.connect(edgeFilter);
    edgeFilter.connect(env);
    env.connect(this.destination);

    source.start(now);
    source.stop(now + burstDur + 0.02);
    source.onended = () => {
      source.disconnect();
      sweepFilter.disconnect();
      edgeFilter.disconnect();
      env.disconnect();
    };

    return { startHz, endHz };
  }
}
