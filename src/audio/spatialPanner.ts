import { LAYER_ORDER, LayerKey, NASA_GIBS_LAYERS } from '../types/bea';

export type SpatialInterpolationMode = 'cardinal' | 'smooth360';

function normalizeAngleDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function shortestSignedAngleDelta(fromDeg: number, toDeg: number): number {
  return ((toDeg - fromDeg + 540) % 360) - 180;
}

export class SpatialPanner {
  private ctx: AudioContext;
  private panners: Record<LayerKey, PannerNode>;
  private currentHeadingDeg = 0;
  private targetHeadingDeg = 0;
  private rafId: number | null = null;
  private lastStepTimeMs = 0;
  private onInterpolateStep: ((interpolatedDeg: number) => void) | null = null;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;

    const created = {} as Record<LayerKey, PannerNode>;

    for (const key of LAYER_ORDER) {
      const meta = NASA_GIBS_LAYERS[key];
      const panner = new PannerNode(ctx, {
        panningModel: 'HRTF',
        distanceModel: 'inverse',
        refDistance: 1,
        maxDistance: 10,
        rolloffFactor: 1,
        positionX: meta.position.x,
        positionY: meta.position.y,
        positionZ: meta.position.z,
      });

      panner.connect(destination);
      created[key] = panner;
    }

    this.panners = created;
    this.applyListenerOrientationImmediate(0);
  }

  public getPanner(layerKey: LayerKey): PannerNode {
    return this.panners[layerKey];
  }

  public getCurrentHeading(): number {
    return this.currentHeadingDeg;
  }

  private applyListenerOrientationImmediate(headingDegrees: number, timeConstantSec = 0.01): void {
    const normalized = normalizeAngleDeg(headingDegrees);
    const phi = (normalized * Math.PI) / 180;
    const forwardX = Math.sin(phi);
    const forwardZ = -Math.cos(phi);
    const now = this.ctx.currentTime;
    const listener = this.ctx.listener;

    if (listener.positionX) {
      listener.positionX.setValueAtTime(0, now);
      listener.positionY.setValueAtTime(0, now);
      listener.positionZ.setValueAtTime(0, now);
    }

    if (listener.forwardX && listener.upY) {
      listener.forwardX.setTargetAtTime(forwardX, now, timeConstantSec);
      listener.forwardY.setTargetAtTime(0, now, timeConstantSec);
      listener.forwardZ.setTargetAtTime(forwardZ, now, timeConstantSec);
      listener.upX.setTargetAtTime(0, now, timeConstantSec);
      listener.upY.setTargetAtTime(1, now, timeConstantSec);
      listener.upZ.setTargetAtTime(0, now, timeConstantSec);
    } else if (typeof listener.setOrientation === 'function') {
      listener.setOrientation(forwardX, 0, forwardZ, 0, 1, 0);
    }
  }

  private cancelArcAnimation(): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Rotates virtual AudioListener head orientation in degrees clockwise from North (0 deg).
   * - In 'smooth360' mode: continuously interpolates along the circular 360-degree arc
   *   so (forwardX, forwardZ) remains strictly on the unit circle without chord collapse.
   * - In 'cardinal' mode: transitions smoothly across the 500ms crossfade window.
   */
  public updateListenerOrientation(
    headingDegrees: number,
    transitionDurationSec = 0.5,
    mode: SpatialInterpolationMode = 'smooth360',
    onStep?: (interpolatedDeg: number) => void
  ): void {
    const normalizedTarget = normalizeAngleDeg(headingDegrees);
    this.targetHeadingDeg = normalizedTarget;
    this.onInterpolateStep = onStep ?? null;

    if (mode === 'cardinal' || transitionDurationSec <= 0.025) {
      this.cancelArcAnimation();
      this.currentHeadingDeg = normalizedTarget;
      const tau =
        transitionDurationSec <= 0.025 ? 0.01 : Math.max(0.015, transitionDurationSec / 4);
      this.applyListenerOrientationImmediate(normalizedTarget, tau);
      this.onInterpolateStep?.(normalizedTarget);
      return;
    }

    // Continuous circular-arc HRTF interpolation in 'smooth360' mode
    const initialDelta = shortestSignedAngleDelta(this.currentHeadingDeg, normalizedTarget);
    if (Math.abs(initialDelta) <= 0.25) {
      this.cancelArcAnimation();
      this.currentHeadingDeg = normalizedTarget;
      this.applyListenerOrientationImmediate(normalizedTarget, 0.012);
      this.onInterpolateStep?.(normalizedTarget);
      return;
    }

    if (this.rafId !== null) {
      return;
    }

    this.lastStepTimeMs = performance.now();
    const tauArcSec = Math.max(0.045, Math.min(0.18, transitionDurationSec * 0.26));

    const tick = (nowMs: number) => {
      const dtSec = Math.min(0.05, Math.max(0.001, (nowMs - this.lastStepTimeMs) / 1000));
      this.lastStepTimeMs = nowMs;

      const delta = shortestSignedAngleDelta(this.currentHeadingDeg, this.targetHeadingDeg);
      if (Math.abs(delta) <= 0.15) {
        this.currentHeadingDeg = this.targetHeadingDeg;
        this.applyListenerOrientationImmediate(this.currentHeadingDeg, 0.012);
        this.onInterpolateStep?.(this.currentHeadingDeg);
        this.rafId = null;
        return;
      }

      const alpha = 1 - Math.exp(-dtSec / tauArcSec);
      this.currentHeadingDeg = normalizeAngleDeg(this.currentHeadingDeg + delta * alpha);
      this.applyListenerOrientationImmediate(this.currentHeadingDeg, 0.012);
      this.onInterpolateStep?.(this.currentHeadingDeg);

      this.rafId = window.requestAnimationFrame(tick);
    };

    this.rafId = window.requestAnimationFrame(tick);
  }

  public dispose(): void {
    this.cancelArcAnimation();
    this.onInterpolateStep = null;
  }
}
