import { useEffect } from 'react';
import { SpatialPanningMode } from '../audio/audioEngine';
import { LayerKey } from '../types/bea';

interface KeyboardControlHandlers {
  disabled?: boolean;
  panningMode?: SpatialPanningMode;
  onTogglePlay: () => void;
  onRotateLeft: (stepDeg: number) => void;
  onRotateRight: (stepDeg: number) => void;
  onSelectCardinal: (layerKey: LayerKey) => void;
  onRequestStatus: () => void;
  onToggleProjection: () => void;
  onToggleAnomalyHeatmap: () => void;
  onToggleSolarTerminator?: () => void;
  onToggleWindFlow?: () => void;
  onToggleStormRadar?: () => void;
  onToggleReverb?: () => void;
  onTogglePanningMode?: () => void;
  onToggleAutoRotate?: () => void;
  onToggleMagneticSnap?: () => void;
  onToggleAtmosphericFlow?: () => void;
  onToggleNightMode?: () => void;
}

/**
 * Global Accessible Keyboard Bus:
 * - Space / Enter: Toggle Sequencer Sonification
 * - ArrowLeft / ArrowRight: Rotate head (15° / 5° fine in 360° Smooth mode; 90° / 15° in Cardinal Snap)
 * - 1, 2, 3, 4: Direct cardinal jump (North, East, South, West)
 * - H: Speak current heading, active layer, and observation date
 * - M: Toggle 3D Globe / Plate Carree Map projection
 * - A: Toggle D3 Climate Anomaly Heatmap overlay
 * - T: Toggle real-time UTC Solar Terminators overlay
 * - V: Toggle animated Wind Flow streamlines overlay on Globe & Map
 * - S: Toggle animated D3 Storm Radar pressure-contour overlay
 * - R: Toggle Environment Reverb (Vacuum/Deep Space vs Planetary Atmospheric)
 * - P: Toggle Spatial Panning Mode (Full 360° Smooth vs Cardinal Snap)
 * - O: Toggle Radar Compass Auto-Rotate (5°/s passive 360° scan)
 * - G: Toggle Magnetic Snap to High-Intensity Climate Anomalies
 * - W: Toggle Atmospheric Flow (Granular Wind Noise-Floor)
 * - N: Toggle Observatory Night Mode (Deep Red Dark-Adaptation)
 */
export function useKeyboardControls(handlers: KeyboardControlHandlers): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (handlers.disabled) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const inputType = (target as HTMLInputElement | null)?.type?.toLowerCase();

      if (tag === 'input' && inputType !== 'range') return;
      if (tag === 'textarea' || tag === 'select') return;

      const isSmooth360 = (handlers.panningMode ?? 'smooth360') === 'smooth360';
      const stepDeg = isSmooth360 ? (e.shiftKey ? 5 : 15) : e.shiftKey ? 15 : 90;

      if (e.key === 'ArrowLeft') {
        if (tag === 'input' && inputType === 'range') return;
        e.preventDefault();
        handlers.onRotateLeft(stepDeg);
        return;
      }

      if (e.key === 'ArrowRight') {
        if (tag === 'input' && inputType === 'range') return;
        e.preventDefault();
        handlers.onRotateRight(stepDeg);
        return;
      }

      if (e.key === '1') {
        e.preventDefault();
        handlers.onSelectCardinal('north');
        return;
      }
      if (e.key === '2') {
        e.preventDefault();
        handlers.onSelectCardinal('east');
        return;
      }
      if (e.key === '3') {
        e.preventDefault();
        handlers.onSelectCardinal('south');
        return;
      }
      if (e.key === '4') {
        e.preventDefault();
        handlers.onSelectCardinal('west');
        return;
      }

      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        handlers.onRequestStatus();
        return;
      }

      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        handlers.onToggleProjection();
        return;
      }

      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        handlers.onToggleAnomalyHeatmap();
        return;
      }

      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        handlers.onToggleSolarTerminator?.();
        return;
      }

      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        handlers.onToggleWindFlow?.();
        return;
      }

      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        handlers.onToggleStormRadar?.();
        return;
      }

      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        handlers.onToggleReverb?.();
        return;
      }

      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        handlers.onTogglePanningMode?.();
        return;
      }

      if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        handlers.onToggleAutoRotate?.();
        return;
      }

      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        handlers.onToggleMagneticSnap?.();
        return;
      }

      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        handlers.onToggleAtmosphericFlow?.();
        return;
      }

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        handlers.onToggleNightMode?.();
        return;
      }

      if (e.code === 'Space' || e.key === ' ') {
        if (tag === 'button') return;
        e.preventDefault();
        handlers.onTogglePlay();
        return;
      }

      if (e.key === 'Enter') {
        if (tag === 'button' || tag === 'a') return;
        e.preventDefault();
        handlers.onTogglePlay();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}
