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
}

export const TemporalTrendsChart: React.FC<TemporalTrendsChartProps> = ({
  history,
  archiveYear,
  maxMonths,
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
    chart.data.labels = history.map((pt) => pt.label);
    chart.data.datasets[0].data = history.map((pt) => Number(pt.intensity.toFixed(3)));
    chart.data.datasets[1].data = history.map((pt) => Number(pt.anomaly.toFixed(3)));
    chart.update('none');
  }, [history]);

  return (
    <section
      aria-label={`${archiveYear} Temporal Trends Chart`}
      className="border border-[#1A2E44] bg-[#0B1320] flex flex-col"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1A2E44] bg-[#111D30]">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#F1F5F9]">
          {archiveYear} Temporal Trajectory
        </h2>
        <span className="text-[11px] font-mono-tabular text-[#5EEAD4]">
          {history.length} / {maxMonths} MONTHS
        </span>
      </div>
      <div className="p-3 bg-[#060B14] h-[168px] w-full">
        <canvas ref={canvasRef} aria-label={`${archiveYear} Temporal Trends Chart`} />
      </div>
    </section>
  );
};
