import { FeatureVector, LayerKey } from '../types/bea';

// Cache previous monthly luminance frame per cardinal layer for inter-frame motion delta
const previousLuminanceCache = new Map<LayerKey, Float32Array>();

function clamp01(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.max(0, Math.min(1, val));
}

/**
 * Extracts 6 deterministic normalized signals [0.0, 1.0] from a 1024x512 Canvas 2D frame:
 * 1. Brightness (ITU-R BT.601 Luminance)
 * 2. Hue (Circular Saturation-Weighted Mean Angle)
 * 3. Saturation (Chroma Purity)
 * 4. Edge Density (Horizontal & Vertical Luminance Gradient)
 * 5. Frame Motion (Inter-Frame Temporal Delta)
 * 6. Climate Anomaly (Statistical Variance & >2 sigma Outlier Ratio)
 */
export function extractFeatureVector(
  canvas: HTMLCanvasElement,
  layerKey: LayerKey
): FeatureVector {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return {
      brightness: 0,
      hue: 0,
      saturation: 0,
      edgeDensity: 0,
      motion: 0,
      climateAnomaly: 0,
    };
  }

  const width = canvas.width;
  const height = canvas.height;
  const { data } = ctx.getImageData(0, 0, width, height);

  // Sample every 4th pixel horizontally & vertically (256x128 = 32,768 samples) for <4ms deterministic analysis
  const step = 4;
  const cols = Math.floor(width / step);
  const rows = Math.floor(height / step);
  const sampleCount = cols * rows;

  const luminanceGrid = new Float32Array(sampleCount);

  let sumLuminance = 0;
  let sumSat = 0;
  let satNonBlackCount = 0;
  let sumCosHue = 0;
  let sumSinHue = 0;

  let idx = 0;
  for (let y = 0; y < rows; y++) {
    const py = y * step;
    for (let x = 0; x < cols; x++) {
      const px = x * step;
      const offset = (py * width + px) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];

      // 1. ITU-R BT.601 Perceived Luminance
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      luminanceGrid[idx++] = lum;
      sumLuminance += lum;

      // RGB -> HSV Saturation & Hue Angle
      const rn = r / 255;
      const gn = g / 255;
      const bn = b / 255;
      const max = Math.max(rn, gn, bn);
      const min = Math.min(rn, gn, bn);
      const delta = max - min;

      if (max > 0.02) {
        const sat = delta / (max + 1e-6);
        sumSat += sat;
        satNonBlackCount++;

        if (delta > 1e-4) {
          let hueDeg = 0;
          if (max === rn) {
            hueDeg = 60 * (((gn - bn) / delta) % 6);
          } else if (max === gn) {
            hueDeg = 60 * ((bn - rn) / delta + 2);
          } else {
            hueDeg = 60 * ((rn - gn) / delta + 4);
          }
          if (hueDeg < 0) hueDeg += 360;
          const theta = (hueDeg * Math.PI) / 180;
          sumCosHue += sat * Math.cos(theta);
          sumSinHue += sat * Math.sin(theta);
        }
      }
    }
  }

  // Signal 1: Brightness
  const meanLum = sumLuminance / sampleCount;
  const brightness = clamp01(meanLum / 255);

  // Signal 2: Circular Average Hue [0, 1]
  let hue = 0;
  if (Math.abs(sumCosHue) > 1e-6 || Math.abs(sumSinHue) > 1e-6) {
    let angle = Math.atan2(sumSinHue, sumCosHue);
    if (angle < 0) angle += 2 * Math.PI;
    hue = clamp01(angle / (2 * Math.PI));
  }

  // Signal 3: Saturation
  const saturation = clamp01(satNonBlackCount > 0 ? sumSat / satNonBlackCount : 0);

  // Signal 4: Edge Density (Horizontal & Vertical Gradient)
  let gradientSum = 0;
  let edgeSamples = 0;
  for (let y = 0; y < rows - 1; y++) {
    const rowBase = y * cols;
    for (let x = 0; x < cols - 1; x++) {
      const c = luminanceGrid[rowBase + x];
      const dh = Math.abs(luminanceGrid[rowBase + x + 1] - c);
      const dv = Math.abs(luminanceGrid[rowBase + cols + x] - c);
      gradientSum += (dh + dv) / (2 * 255);
      edgeSamples++;
    }
  }
  const edgeDensity = clamp01((gradientSum / Math.max(1, edgeSamples)) * 4.0);

  // Signal 5: Inter-Frame Motion
  let motion = 0.28; // Initial reference cadence before second frame arrives
  const prevGrid = previousLuminanceCache.get(layerKey);
  if (prevGrid && prevGrid.length === luminanceGrid.length) {
    let diffSum = 0;
    for (let i = 0; i < sampleCount; i++) {
      diffSum += Math.abs(luminanceGrid[i] - prevGrid[i]) / 255;
    }
    motion = clamp01((diffSum / sampleCount) * 5.0);
  }
  previousLuminanceCache.set(layerKey, luminanceGrid);

  // Signal 6: Climate Anomaly (Standard Deviation + >2 sigma Outlier Ratio)
  let sqDiffSum = 0;
  for (let i = 0; i < sampleCount; i++) {
    const d = luminanceGrid[i] - meanLum;
    sqDiffSum += d * d;
  }
  const sigma = Math.sqrt(sqDiffSum / sampleCount);
  const threshold = 2.0 * sigma;
  let outlierCount = 0;
  if (threshold > 1e-3) {
    for (let i = 0; i < sampleCount; i++) {
      if (Math.abs(luminanceGrid[i] - meanLum) > threshold) {
        outlierCount++;
      }
    }
  }
  const outlierRatio = outlierCount / sampleCount;
  const climateAnomaly = clamp01(outlierRatio * 3.0 + (sigma / 128) * 0.5);

  return {
    brightness,
    hue,
    saturation,
    edgeDensity,
    motion,
    climateAnomaly,
  };
}

export function resetFeatureVectorCache(): void {
  previousLuminanceCache.clear();
}
