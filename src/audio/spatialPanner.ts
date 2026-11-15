import { LAYER_ORDER, LayerKey, NASA_GIBS_LAYERS } from '../types/bea';

export class SpatialPanner {
  private ctx: AudioContext;
  private panners: Record<LayerKey, PannerNode>;

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
    this.updateListenerOrientation(0);
  }

  public getPanner(layerKey: LayerKey): PannerNode {
    return this.panners[layerKey];
  }

  /**
   * Rotates virtual AudioListener head orientation in degrees clockwise from North (0 deg).
   * forwardX = sin(phi), forwardY = 0, forwardZ = -cos(phi)
   * Smoothly interpolated using setTargetAtTime (tau = 0.05s) to prevent clicks.
   */
  public updateListenerOrientation(headingDegrees: number): void {
    const phi = (headingDegrees * Math.PI) / 180;
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
      listener.forwardX.setTargetAtTime(forwardX, now, 0.05);
      listener.forwardY.setTargetAtTime(0, now, 0.05);
      listener.forwardZ.setTargetAtTime(forwardZ, now, 0.05);
      listener.upX.setTargetAtTime(0, now, 0.05);
      listener.upY.setTargetAtTime(1, now, 0.05);
      listener.upZ.setTargetAtTime(0, now, 0.05);
    } else if (typeof listener.setOrientation === 'function') {
      listener.setOrientation(forwardX, 0, forwardZ, 0, 1, 0);
    }
  }
}
