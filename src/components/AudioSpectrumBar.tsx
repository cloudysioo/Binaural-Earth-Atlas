import React, { useEffect, useRef } from 'react';
import { BeaThemePalette, resolveTheme } from '../theme/themes';

interface AudioSpectrumBarProps {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
  isTestingSpatial: boolean;
  nightMode?: boolean;
  theme?: BeaThemePalette;
}

export const AudioSpectrumBar: React.FC<AudioSpectrumBarProps> = ({
  analyser,
  isPlaying,
  isTestingSpatial,
  nightMode = false,
  theme,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pal = resolveTheme(theme, nightMode);
    const c = pal.canvas;
    const isNight = pal.isNightFilter;

    let rafId = 0;
    const active = isPlaying || isTestingSpatial;
    const bufferLen = analyser ? analyser.frequencyBinCount : 128;
    const timeData = new Uint8Array(bufferLen);
    const freqData = new Uint8Array(bufferLen);

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = c.bg;
      ctx.fillRect(0, 0, w, h);

      // Center zero-crossing reference hairline
      ctx.strokeStyle = c.axisLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      if (analyser && active) {
        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(timeData);

        // 32-band harmonic spectrum bars
        const bars = 32;
        const barW = w / bars;
        ctx.fillStyle = `rgba(${c.primaryRgb}, ${isNight ? '0.14' : '0.22'})`;
        for (let i = 0; i < bars; i++) {
          const val = freqData[i * 2] / 255;
          const barH = Math.max(1, val * (h - 6));
          ctx.fillRect(i * barW + 1, h - barH, Math.max(1, barW - 2), barH);
        }

        // Live oscilloscope time-domain trace
        ctx.strokeStyle = isTestingSpatial ? c.secondary : c.primary;
        ctx.lineWidth = isNight ? 1.25 : 1.5;
        ctx.beginPath();
        const sliceW = w / bufferLen;
        for (let i = 0; i < bufferLen; i++) {
          const v = timeData[i] / 128.0;
          const y = (v * h) / 2;
          if (i === 0) ctx.moveTo(0, y);
          else ctx.lineTo(i * sliceW, y);
        }
        ctx.stroke();
      } else {
        // Standby flat trace
        ctx.strokeStyle = c.gridLine;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
      }

      if (active) {
        rafId = window.requestAnimationFrame(draw);
      }
    };

    draw();
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [analyser, isPlaying, isTestingSpatial, nightMode, theme]);

  return (
    <div className="border border-[var(--border-strong)] bg-[var(--bg-console)] p-2.5">
      <div className="flex items-center justify-between text-xs font-mono-tabular mb-1.5">
        <span className="font-semibold text-[var(--text-primary)]">
          LIVE BINAURAL OUTPUT OSCILLOSCOPE
        </span>
        <span
          className={
            isPlaying || isTestingSpatial
              ? 'text-[var(--accent-mint)] font-semibold'
              : 'text-[var(--text-muted)]'
          }
        >
          {isTestingSpatial ? 'CALIBRATION SIGNAL' : isPlaying ? 'HRTF STREAM' : 'STANDBY'}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        width={420}
        height={58}
        className="w-full h-[58px] block border border-[var(--border-grid)] bg-[var(--bg-obsidian)]"
        aria-label="Live binaural audio output waveform and harmonic spectrum"
      />
    </div>
  );
};
