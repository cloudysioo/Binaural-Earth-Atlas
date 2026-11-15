import React, { useEffect, useRef } from 'react';

interface AudioSpectrumBarProps {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
  isTestingSpatial: boolean;
}

export const AudioSpectrumBar: React.FC<AudioSpectrumBarProps> = ({
  analyser,
  isPlaying,
  isTestingSpatial,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    const active = isPlaying || isTestingSpatial;
    const bufferLen = analyser ? analyser.frequencyBinCount : 128;
    const timeData = new Uint8Array(bufferLen);
    const freqData = new Uint8Array(bufferLen);

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = '#060B14';
      ctx.fillRect(0, 0, w, h);

      // Center zero-crossing reference hairline
      ctx.strokeStyle = 'rgba(26, 46, 68, 0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      if (analyser && active) {
        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(timeData);

        // 32-band harmonic spectrum bars (subtle backdrop)
        const bars = 32;
        const barW = w / bars;
        ctx.fillStyle = 'rgba(94, 234, 212, 0.22)';
        for (let i = 0; i < bars; i++) {
          const val = freqData[i * 2] / 255;
          const barH = Math.max(1, val * (h - 6));
          ctx.fillRect(i * barW + 1, h - barH, Math.max(1, barW - 2), barH);
        }

        // Live oscilloscope time-domain trace
        ctx.strokeStyle = isTestingSpatial ? '#FB7185' : '#5EEAD4';
        ctx.lineWidth = 1.5;
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
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
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
  }, [analyser, isPlaying, isTestingSpatial]);

  return (
    <div className="border border-[#1A2E44] bg-[#060B14] p-2">
      <div className="flex items-center justify-between text-[11px] font-mono-tabular text-[#94A3B8] mb-1">
        <span>LIVE BINAURAL OUTPUT OSCILLOSCOPE</span>
        <span className={isPlaying || isTestingSpatial ? 'text-[#5EEAD4]' : 'text-[#94A3B8]'}>
          {isTestingSpatial ? 'CALIBRATION SIGNAL' : isPlaying ? 'HRTF STREAM' : 'SILENT'}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        width={420}
        height={58}
        className="w-full h-[58px] block border border-[#1A2E44]"
        aria-label="Live binaural audio output waveform and harmonic spectrum"
      />
    </div>
  );
};
