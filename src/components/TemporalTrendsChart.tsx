import React, { useEffect, useRef } from 'react';
import {
  CategoryScale,
  Chart,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { TelemetryPoint } from '../types/bea';

Chart.register(
  CategoryScale,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  Legend
);

interface TemporalTrendsChartProps {
  history: TelemetryPoint[];
  archiveYear: number;
  maxMonths: number;
  nightMode?: boolean;
}

export const TemporalTrendsChart: React.FC<TemporalTrendsChartProps> = ({
  history,
  archiveYear,
  maxMonths,
  nightMode = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart<'line'> | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    chartRef.current = new Chart(canvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Signal Intensity',
            data: [],
            borderColor: '#5EEAD4',
            backgroundColor: '#5EEAD4',
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            tension: 0,
            fill: false,
          },
          {
            label: 'Climate Anomaly',
            data: [],
            borderColor: '#FB7185',
            backgroundColor: '#FB7185',
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            tension: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: {
            display: true,
            labels: {
              color: '#F1F5F9',
              boxWidth: 10,
              boxHeight: 2,
              font: {
                family: '"JetBrains Mono", monospace',
                size: 10,
              },
            },
          },
          tooltip: {
            backgroundColor: '#060B14',
            borderColor: '#1A2E44',
            borderWidth: 1,
            cornerRadius: 0,
            titleFont: { family: '"JetBrains Mono", monospace', size: 11 },
            bodyFont: { family: '"JetBrains Mono", monospace', size: 11 },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#94A3B8',
              font: { family: '"JetBrains Mono", monospace', size: 10 },
              maxRotation: 0,
            },
            grid: {
              color: 'rgba(26, 46, 68, 0.55)',
            },
          },
          y: {
            min: 0,
            max: 1,
            ticks: {
              stepSize: 0.25,
              color: '#94A3B8',
              font: { family: '"JetBrains Mono", monospace', size: 10 },
            },
            grid: {
              color: 'rgba(26, 46, 68, 0.55)',
            },
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const primaryTrace = nightMode ? '#FF453A' : '#5EEAD4';
    const secondaryTrace = nightMode ? '#F0522E' : '#FB7185';
    const textPrimary = nightMode ? '#FF7875' : '#F8FAFC';
    const textMuted = nightMode ? '#F47272' : '#B9C8DC';
    const gridColor = nightMode ? 'rgba(194, 48, 66, 0.45)' : 'rgba(75, 115, 156, 0.45)';

    chart.data.labels = history.map((pt) => pt.label);
    chart.data.datasets[0].data = history.map((pt) => Number(pt.intensity.toFixed(3)));
    chart.data.datasets[0].borderColor = primaryTrace;
    chart.data.datasets[0].backgroundColor = primaryTrace;
    chart.data.datasets[1].data = history.map((pt) => Number(pt.anomaly.toFixed(3)));
    chart.data.datasets[1].borderColor = secondaryTrace;
    chart.data.datasets[1].backgroundColor = secondaryTrace;

    if (chart.options.plugins?.legend?.labels) {
      chart.options.plugins.legend.labels.color = textPrimary;
    }
    if (chart.options.plugins?.tooltip) {
      chart.options.plugins.tooltip.backgroundColor = nightMode ? '#070102' : '#060B14';
      chart.options.plugins.tooltip.borderColor = nightMode ? '#C23042' : '#4B739C';
      chart.options.plugins.tooltip.titleColor = textPrimary;
      chart.options.plugins.tooltip.bodyColor = textPrimary;
    }
    if (chart.options.scales?.x?.ticks) chart.options.scales.x.ticks.color = textMuted;
    if (chart.options.scales?.x?.grid) chart.options.scales.x.grid.color = gridColor;
    if (chart.options.scales?.y?.ticks) chart.options.scales.y.ticks.color = textMuted;
    if (chart.options.scales?.y?.grid) chart.options.scales.y.grid.color = gridColor;

    chart.update('none');
  }, [history, nightMode]);

  return (
    <section
      aria-label={`${archiveYear} Temporal Trends Chart`}
      className="border border-[var(--border-strong)] bg-[var(--bg-console)] flex flex-col"
    >
      <div className="flex items-center justify-between gap-2 px-3 h-[38px] border-b border-[var(--border-grid)] bg-[var(--bg-panel)] whitespace-nowrap min-w-0">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] truncate">
          {archiveYear} Temporal Trajectory
        </h2>
        <span className="text-xs font-mono-tabular font-semibold text-[var(--accent-mint)] shrink-0">
          {history.length} / {maxMonths} MONTHS
        </span>
      </div>
      <div className="p-3 bg-[var(--bg-obsidian)] h-[168px] w-full shrink-0">
        <canvas ref={canvasRef} aria-label={`${archiveYear} Temporal Trends Chart`} />
      </div>
    </section>
  );
};
