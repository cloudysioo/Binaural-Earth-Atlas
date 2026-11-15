/**
 * Glitchy Metallic Auroral Chime Synthesizer:
 * Renders multi-grain inharmonic FM metallic chimes with stepped sample-and-hold
 * pitch/filter micro-glitches and stereo ping-pong scatter whenever high-intensity
 * solar activity indicates elevated auroral potential.
 */
export class SolarChimeSynth {
  private ctx: AudioContext;
  private destination: AudioNode;
  private pulseSeq = 0;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.destination = destination;
  }

  /**
   * Triggers a 5-burst glitchy metallic chime cascade across ~0.78s.
   * Returns the primary chime carrier frequency in Hz for telemetry logging.
   */
  public triggerAuroralChime(solarIntensity = 0.8): number {
    if (this.ctx.state !== 'running') {
      return 587;
    }

    const clamped = Math.max(0.2, Math.min(1, solarIntensity));
    const baseCandidates = [440, 493.88, 554.37, 587.33, 659.25, 739.99];
    this.pulseSeq = (this.pulseSeq + 1) >>> 0;
    const baseFreq = baseCandidates[this.pulseSeq % baseCandidates.length];

    // Staggered timing offsets & metallic FM ratios create fragmented auroral shimmer
    const grainSpecs = [
      { delay: 0.0, dur: 0.34, ratio: 1.0, modRatio: 1.414, pan: -0.68, amp: 0.22 },
      { delay: 0.055, dur: 0.09, ratio: 2.756, modRatio: 3.141, pan: 0.72, amp: 0.17 },
      { delay: 0.115, dur: 0.075, ratio: 1.98, modRatio: 2.414, pan: -0.45, amp: 0.16 },
      { delay: 0.185, dur: 0.48, ratio: 1.505, modRatio: 2.718, pan: 0.58, amp: 0.21 },
      { delay: 0.31, dur: 0.12, ratio: 3.17, modRatio: 1.618, pan: -0.82, amp: 0.13 },
    ];

    const masterNow = this.ctx.currentTime;

    grainSpecs.forEach((spec, idx) => {
      const startTime = masterNow + spec.delay;
      const carrierFreq = baseFreq * spec.ratio;
      const modFreq = carrierFreq * spec.modRatio;

      // Carrier oscillator (pure metallic ring core)
      const carrier = this.ctx.createOscillator();
      carrier.type = 'sine';
      carrier.frequency.setValueAtTime(carrierFreq, startTime);

      // Glitchy stepped pitch micro-detune mid-burst for digital telemetry stutter
      if (idx === 1 || idx === 2 || idx === 4) {
        const glitchFreq = carrierFreq * (idx === 2 ? 1.125 : 0.89);
        carrier.frequency.setValueAtTime(glitchFreq, startTime + spec.dur * 0.45);
      }

      // FM Modulator (inharmonic metallic bell transient)
      const modOsc = this.ctx.createOscillator();
      modOsc.type = idx % 2 === 0 ? 'triangle' : 'square';
      modOsc.frequency.setValueAtTime(modFreq, startTime);

      const modGain = this.ctx.createGain();
      const peakIndex = carrierFreq * (0.45 + clamped * 0.55);
      modGain.gain.setValueAtTime(peakIndex, startTime);
      modGain.gain.exponentialRampToValueAtTime(Math.max(4, peakIndex * 0.03), startTime + spec.dur);

      // Resonant bandpass comb keeps chime glassy without harsh sub-piercing spike
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(Math.min(3400, carrierFreq * 1.15), startTime);
      bp.Q.setValueAtTime(3.2 + clamped * 2.5, startTime);

      // Crisp micro-attack (4ms) + glitchy stepped amplitude decay
      const env = this.ctx.createGain();
      const peakGain = spec.amp * (0.7 + clamped * 0.45);
      env.gain.setValueAtTime(0.0001, startTime);
      env.gain.linearRampToValueAtTime(peakGain, startTime + 0.004);
      if (idx === 1 || idx === 4) {
        // Brief 12ms stutter notch inside glitch grains (click-free 3ms ramp)
        env.gain.linearRampToValueAtTime(peakGain * 0.12, startTime + spec.dur * 0.38);
        env.gain.linearRampToValueAtTime(peakGain * 0.82, startTime + spec.dur * 0.52);
      }
      env.gain.exponentialRampToValueAtTime(0.0001, startTime + spec.dur);

      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(spec.pan, startTime);

      modOsc.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(bp);
      bp.connect(env);
      env.connect(panner);
      panner.connect(this.destination);

      carrier.start(startTime);
      modOsc.start(startTime);
      carrier.stop(startTime + spec.dur + 0.02);
      modOsc.stop(startTime + spec.dur + 0.02);

      carrier.onended = () => {
        modOsc.disconnect();
        modGain.disconnect();
        carrier.disconnect();
        bp.disconnect();
        env.disconnect();
        panner.disconnect();
      };
    });

    return Math.round(baseFreq);
  }
}
