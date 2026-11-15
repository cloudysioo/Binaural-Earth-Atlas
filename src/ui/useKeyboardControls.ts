import { useEffect } from 'react';
import { LayerKey } from '../types/bea';

interface KeyboardControlHandlers {
  disabled?: boolean;
  onTogglePlay: () => void;
  onRotateLeft: (stepDeg: number) => void;
  onRotateRight: (stepDeg: number) => void;
  onSelectCardinal: (layerKey: LayerKey) => void;
  onRequestStatus: () => void;
  onToggleProjection: () => void;
  onToggleAnomalyHeatmap: () => void;
}

/**
 * Global Accessible Keyboard Bus:
 * - Space / Enter: Toggle Sequencer Sonification
 * - ArrowLeft / ArrowRight: Rotate virtual head 90 degrees CCW / CW (Shift = 15 degrees fine)
 * - 1, 2, 3, 4: Direct cardinal jump (North, East, South, West)
 * - H: Speak current heading, active layer, and observation date
 * - M: Toggle 3D Globe / Plate Carree Map projection
 * - A: Toggle D3 Climate Anomaly Heatmap overlay
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

      const stepDeg = e.shiftKey ? 15 : 90;

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
