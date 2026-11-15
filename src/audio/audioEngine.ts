import { FeatureVector, LAYER_ORDER, LayerKey, NASA_GIBS_LAYERS } from '../types/bea';
import { LayerSynth } from './layerSynth';
import { ScaleMode } from './scales';
import { SpatialPanner } from './spatialPanner';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;
  private spatialPanner: SpatialPanner | null = null;
  private synths: Record<LayerKey, LayerSynth> | null = null;
  private masterVolume = 0.72;
  private activeHeading = 0;
  private scaleMode: ScaleMode = 'pentatonic';
  private isAudioRunning = false;
  private testTimers: number[] = [];

  public isInitialized(): boolean {
    return this.ctx !== null;
  }

  public isRunning(): boolean {
    return this.isAudioRunning;
  }

  public setScaleMode(mode: ScaleMode): void {
    this.scaleMode = mode;
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

      this.compressor.connect(this.analyser);
      this.analyser.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.spatialPanner = new SpatialPanner(this.ctx, this.compressor);

      const synthMap = {} as Record<LayerKey, LayerSynth>;
      for (const key of LAYER_ORDER) {
        synthMap[key] = new LayerSynth(this.ctx, key, this.spatialPanner.getPanner(key));
      }
      this.synths = synthMap;
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.setHeading(this.activeHeading);
    return this.ctx;
  }

  public async start(): Promise<void> {
    await this.initOnUserGesture();
    if (!this.synths) return;
    for (const key of LAYER_ORDER) {
      this.synths[key].start();
    }
    this.isAudioRunning = true;
    this.setHeading(this.activeHeading);
  }

  public stop(): void {
    this.clearTestTimers();
    if (this.synths) {
      for (const key of LAYER_ORDER) {
        this.synths[key].stop();
      }
    }
    this.isAudioRunning = false;
  }

  public setMasterVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.masterVolume = clamped;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.04);
    }
  }

  public setHeading(headingDegrees: number): void {
    this.activeHeading = ((headingDegrees % 360) + 360) % 360;

    if (this.spatialPanner) {
      this.spatialPanner.updateListenerOrientation(this.activeHeading);
    }

    if (this.synths) {
      for (const key of LAYER_ORDER) {
        const layerAzimuth = NASA_GIBS_LAYERS[key].azimuth;
        const delta = Math.abs(this.activeHeading - layerAzimuth);
        const shortest = Math.min(delta, 360 - delta);
        this.synths[key].setAngularFocus(shortest);
      }
    }
  }

  public updateAllLayers(
    vectors: Record<LayerKey, FeatureVector>,
    cadenceMs: number
  ): Record<LayerKey, number> {
    const freqs: Record<LayerKey, number> = {
      north: 0,
      east: 0,
      south: 0,
      west: 0,
    };
    if (!this.synths || !this.isAudioRunning) return freqs;

    for (const key of LAYER_ORDER) {
      freqs[key] = this.synths[key].updateFromFeatures(vectors[key], cadenceMs, this.scaleMode);
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

    this.spatialPanner.updateListenerOrientation(this.activeHeading);

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
    if (this.synths) {
      for (const key of LAYER_ORDER) {
        this.synths[key].dispose();
      }
      this.synths = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
