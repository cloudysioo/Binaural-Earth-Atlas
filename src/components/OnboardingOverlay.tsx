import React, { useEffect, useRef, useState } from 'react';
import {
  Globe,
  Headphones,
  Layers,
  Play,
  Radio,
  Sliders,
  Speech,
  Thermometer,
  X,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { SCALE_DEFINITIONS, ScaleMode } from '../audio/scales';
import {
  ARCHIVE_YEARS,
  ArchiveYear,
  FeatureVector,
  formatArchiveDate,
  getMaxMonthForYear,
  LAYER_ORDER,
  LayerKey,
  MONTH_NAMES,
  NASA_GIBS_LAYERS,
} from '../types/bea';
import { ProjectionMode } from './SatelliteMapCanvas';

interface OnboardingOverlayProps {
  isOpen: boolean;
  listenerAngle: number;
  activeLayerKey: LayerKey;
  vectors: Record<LayerKey, FeatureVector>;
  frequencies: Record<LayerKey, number>;
  archiveYear: ArchiveYear;
  monthIndex: number;
  scaleMode: ScaleMode;
  projection: ProjectionMode;
  showAnomalyHeatmap: boolean;
  speechEnabled: boolean;
  isPlaying: boolean;
  isTestingSpatial: boolean;
  onClose: (startAudioAfter?: boolean) => void;
  onSelectLayer: (key: LayerKey) => void;
  onRotateStep: (deltaDeg: number) => void;
  onTestSpatialAudio: () => void;
  onScaleModeChange: (mode: ScaleMode) => void;
  onChangeYear: (year: ArchiveYear) => void;
  onScrubMonth: (month: number) => void;
  onToggleProjection: (mode: ProjectionMode) => void;
  onToggleAnomalyHeatmap: () => void;
  onToggleSpeech: () => void;
  onAnnounceStep: (message: string) => void;
}

const STEP_TITLES = [
  'Spatial Heading & 360° Binaural Field',
  'How Satellite Telemetry Shapes Sound',
  'NASA GIBS Archive & D3 Anomaly Layer',
  'Keyboard Controls & Observatory Ready',
] as const;

function computeFocusPct(listenerAngle: number, targetAzimuth: number): number {
  const diffRad = ((listenerAngle - targetAzimuth) * Math.PI) / 180;
  const frontAlignment = Math.max(0, Math.cos(diffRad));
  return Math.round((0.45 + 0.55 * frontAlignment) * 100);
}

export const OnboardingOverlay: React.FC<OnboardingOverlayProps> = ({
  isOpen,
  listenerAngle,
  activeLayerKey,
  vectors,
  frequencies,
  archiveYear,
  monthIndex,
  scaleMode,
  projection,
  showAnomalyHeatmap,
  speechEnabled,
  isPlaying,
  isTestingSpatial,
  onClose,
  onSelectLayer,
  onRotateStep,
  onTestSpatialAudio,
  onScaleModeChange,
  onChangeYear,
  onScrubMonth,
  onToggleProjection,
  onToggleAnomalyHeatmap,
  onToggleSpeech,
  onAnnounceStep,
}) => {
  const [step, setStep] = useState<number>(0);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    onAnnounceStep(
      'Observatory Onboarding Guide opened. Step 1 of 4: Spatial Heading and 360 degree Binaural Field.'
    );
    const timer = window.setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [isOpen, onAnnounceStep]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const goToStep = (nextStep: number) => {
    const clamped = Math.max(0, Math.min(STEP_TITLES.length - 1, nextStep));
    setStep(clamped);
    onAnnounceStep(`Step ${clamped + 1} of 4: ${STEP_TITLES[clamped]}.`);
  };

  const activeLayer = NASA_GIBS_LAYERS[activeLayerKey];
  const activeVec = vectors[activeLayerKey];
  const activeFreq = frequencies[activeLayerKey] ?? 220;
  const activeFilterHz = Math.round(400 + activeVec.saturation * 5600);
  const activeAnomalyPct = Math.round(activeVec.climateAnomaly * 100);
  const activeDateStr = formatArchiveDate(archiveYear, monthIndex);
  const latestMonth = getMaxMonthForYear(archiveYear);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#060B14]/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-heading"
      aria-describedby="onboarding-body"
    >
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto border border-[#5EEAD4] bg-[#0B1320] text-[#F1F5F9] flex flex-col">
        {/* TOP DIALOG BAR */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-[#1A2E44] bg-[#111D30]">
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandLogo size={24} />
            <span className="text-xs font-mono-tabular text-[#5EEAD4] font-semibold whitespace-nowrap">
              STEP 0{step + 1} / 04
            </span>
            <h2
              id="onboarding-heading"
              className="text-sm font-semibold text-[#F1F5F9] truncate"
            >
              {STEP_TITLES[step]}
            </h2>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            onClick={() => onClose(false)}
            aria-label="Close onboarding guide"
            className="px-2 py-1 border border-[#1A2E44] bg-[#060B14] text-[#94A3B8] hover:text-[#F1F5F9] hover:border-[#5EEAD4] text-xs font-mono-tabular flex items-center gap-1 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Skip</span>
          </button>
        </div>

        {/* STEP PROGRESS TABS */}
        <nav
          aria-label="Onboarding Steps"
          className="grid grid-cols-2 sm:grid-cols-4 border-b border-[#1A2E44] bg-[#060B14] text-[11px] font-mono-tabular"
        >
          {STEP_TITLES.map((title, idx) => {
            const isCurrent = step === idx;
            return (
              <button
                key={title}
                type="button"
                onClick={() => goToStep(idx)}
                aria-current={isCurrent ? 'step' : undefined}
                className={`px-3 py-2 border-r border-b sm:border-b-0 border-[#1A2E44] text-left cursor-pointer truncate ${
                  isCurrent
                    ? 'bg-[#111D30] text-[#5EEAD4] font-semibold'
                    : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                0{idx + 1}. {idx === 0 ? 'Binaural Field' : idx === 1 ? 'Sound Mapping' : idx === 2 ? 'Archive & D3' : 'Keyboard'}
              </button>
            );
          })}
        </nav>

        {/* STEP CONTENT BODY */}
        <div id="onboarding-body" className="p-5 flex flex-col gap-4">
          {step === 0 && (
            <>
              <p className="text-sm text-[#F1F5F9] leading-relaxed">
                <strong>Binaural Earth Atlas</strong> places four live NASA Earth observation streams
                at the four cardinal directions around your head using Web Audio{' '}
                <strong className="text-[#5EEAD4]">3D HRTF spatial panning</strong>. Rotating your
                spatial heading shifts which planetary system sits directly in front of you at{' '}
                <strong className="text-[#5EEAD4]">100% focus weight</strong>, while lateral and
                rear layers remain softly present at <strong className="text-[#94A3B8]">45%</strong>{' '}
                so you hear global contrast in stereo space.
              </p>

              {/* LIVE HEADING & CARDINAL FOCUS TABLE */}
              <div className="border border-[#1A2E44] bg-[#060B14] p-3 flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-mono-tabular">
                    <Headphones className="w-4 h-4 text-[#5EEAD4]" aria-hidden="true" />
                    <span className="text-[#94A3B8]">CURRENT HEADING:</span>
                    <strong className="text-[#5EEAD4]">
                      {String(Math.round(listenerAngle)).padStart(3, '0')}° ({activeLayer.cardinal.toUpperCase()})
                    </strong>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onRotateStep(-45)}
                      className="px-2 py-1 border border-[#1A2E44] bg-[#0B1320] text-[#F1F5F9] hover:border-[#5EEAD4] text-xs font-mono-tabular cursor-pointer whitespace-nowrap"
                    >
                      Rotate -45°
                    </button>
                    <button
                      type="button"
                      onClick={() => onRotateStep(45)}
                      className="px-2 py-1 border border-[#1A2E44] bg-[#0B1320] text-[#F1F5F9] hover:border-[#5EEAD4] text-xs font-mono-tabular cursor-pointer whitespace-nowrap"
                    >
                      Rotate +45°
                    </button>
                    <button
                      type="button"
                      onClick={onTestSpatialAudio}
                      disabled={isTestingSpatial}
                      className="px-2.5 py-1 border border-[#5EEAD4] bg-[#111D30] text-[#5EEAD4] hover:bg-[#5EEAD4] hover:text-[#060B14] disabled:opacity-60 text-xs font-mono-tabular flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Radio className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{isTestingSpatial ? 'Sweeping N→E→S→W...' : 'Test Spatial Sweep'}</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {LAYER_ORDER.map((key) => {
                    const meta = NASA_GIBS_LAYERS[key];
                    const focusPct = computeFocusPct(listenerAngle, meta.azimuth);
                    const isFocused = key === activeLayerKey;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onSelectLayer(key)}
                        aria-pressed={isFocused}
                        className={`p-2.5 border text-left cursor-pointer ${
                          isFocused
                            ? 'border-[#5EEAD4] bg-[#111D30]'
                            : 'border-[#1A2E44] bg-[#0B1320] hover:border-[#5EEAD4]'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs font-mono-tabular">
                          <span className={isFocused ? 'text-[#5EEAD4] font-semibold' : 'text-[#F1F5F9] font-semibold'}>
                            {meta.azimuthLabel} {meta.cardinal.toUpperCase()} · {meta.domain.toUpperCase()}
                          </span>
                          <span className="text-[#5EEAD4]">{focusPct}% FOCUS</span>
                        </div>
                        <div className="mt-1 text-xs text-[#94A3B8]">
                          {meta.phenomenon} · {meta.waveformDescription}
                        </div>
                        <div className="mt-1.5 h-1 w-full bg-[#060B14] border border-[#1A2E44]">
                          <div
                            className="h-full bg-[#5EEAD4]"
                            style={{ width: `${focusPct}%` }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-sm text-[#F1F5F9] leading-relaxed">
                Every NASA GIBS satellite frame is analyzed into <strong className="text-[#5EEAD4]">6 normalized telemetry signals</strong> that drive real-time synthesis for each direction. As planetary conditions shift across seasons and headings, the timbre, pitch, rhythm, and harmonic tension respond directly:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="border border-[#1A2E44] bg-[#060B14] p-3">
                  <div className="text-xs font-mono-tabular text-[#5EEAD4] font-semibold">
                    01. BRIGHTNESS → PITCH REGISTER
                  </div>
                  <p className="mt-1 text-xs text-[#94A3B8]">
                    High-albedo polar ice and bright blooms lift pitch octave. Current{' '}
                    {activeLayer.cardinal}: <strong className="text-[#F1F5F9]">{activeFreq.toFixed(0)} Hz</strong>.
                  </p>
                </div>

                <div className="border border-[#1A2E44] bg-[#060B14] p-3">
                  <div className="text-xs font-mono-tabular text-[#5EEAD4] font-semibold">
                    02. HUE ANGLE → SCALE DEGREE
                  </div>
                  <p className="mt-1 text-xs text-[#94A3B8]">
                    Dominant spectral hue maps across quantized musical degrees so color gradients sing smoothly.
                  </p>
                </div>

                <div className="border border-[#1A2E44] bg-[#060B14] p-3">
                  <div className="text-xs font-mono-tabular text-[#5EEAD4] font-semibold">
                    03. SATURATION → FILTER BRIGHTNESS
                  </div>
                  <p className="mt-1 text-xs text-[#94A3B8]">
                    Vivid chlorophyll or thermal plumes open the lowpass filter up to{' '}
                    <strong className="text-[#F1F5F9]">{activeFilterHz} Hz</strong>.
                  </p>
                </div>

                <div className="border border-[#1A2E44] bg-[#060B14] p-3">
                  <div className="text-xs font-mono-tabular text-[#5EEAD4] font-semibold">
                    04. EDGE DENSITY → PULSE SUBDIVISION
                  </div>
                  <p className="mt-1 text-xs text-[#94A3B8]">
                    Sharp coastlines, fronts, and fractured ice trigger <strong className="text-[#F1F5F9]">1× / 2× / 3×</strong> rhythmic subdivisions.
                  </p>
                </div>

                <div className="border border-[#1A2E44] bg-[#060B14] p-3">
                  <div className="text-xs font-mono-tabular text-[#5EEAD4] font-semibold">
                    05. FRAME MOTION → SEQUENCER TEMPO
                  </div>
                  <p className="mt-1 text-xs text-[#94A3B8]">
                    Month-to-month satellite variance accelerates archive playback between{' '}
                    <strong className="text-[#F1F5F9]">2500 ms</strong> and <strong className="text-[#F1F5F9]">1500 ms</strong>.
                  </p>
                </div>

                <div className="border border-[#FB7185] bg-[#060B14] p-3">
                  <div className="text-xs font-mono-tabular text-[#FB7185] font-semibold">
                    06. CLIMATE ANOMALY → DETUNED TENSION
                  </div>
                  <p className="mt-1 text-xs text-[#94A3B8]">
                    Statistical &gt;2σ thermal &amp; ice departures blend a detuned secondary oscillator. Current:{' '}
                    <strong className="text-[#FB7185]">{activeAnomalyPct}%</strong>.
                  </p>
                </div>
              </div>

              <div className="border border-[#1A2E44] bg-[#060B14] p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-mono-tabular text-[#94A3B8]">
                  <Sliders className="w-3.5 h-3.5 text-[#5EEAD4]" aria-hidden="true" />
                  <span>TRY HARMONIC SCALE MODE:</span>
                </div>
                <div className="flex gap-1.5" role="group" aria-label="Try Harmonic Scale Mode">
                  {(['pentatonic', 'dorian', 'harmonic'] as ScaleMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onScaleModeChange(mode)}
                      aria-pressed={scaleMode === mode}
                      className={`px-2.5 py-1 border text-xs font-mono-tabular cursor-pointer whitespace-nowrap ${
                        scaleMode === mode
                          ? 'bg-[#5EEAD4] border-[#5EEAD4] text-[#060B14] font-semibold'
                          : 'bg-[#0B1320] border-[#1A2E44] text-[#94A3B8] hover:text-[#F1F5F9]'
                      }`}
                    >
                      {SCALE_DEFINITIONS[mode].label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-sm text-[#F1F5F9] leading-relaxed">
                Navigate across <strong className="text-[#5EEAD4]">2026 live orbital passes</strong>,{' '}
                <strong>2025</strong>, or the historic <strong>2007</strong> Arctic minimum baseline.
                Drag the <strong>3D Orthographic Globe</strong> to orbit, switch to{' '}
                <strong>EPSG:4326</strong> Plate Carrée, hover any coordinate to inspect point{' '}
                <strong className="text-[#5EEAD4]">Anomaly Intensity %</strong>, or toggle the{' '}
                <strong className="text-[#FB7185]">D3 Climate Anomaly Heatmap</strong> to visualize
                global temperature variance (<code className="font-mono-tabular">ΔT °C</code>).
              </p>

              <div className="border border-[#1A2E44] bg-[#060B14] p-3 flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-mono-tabular text-[#94A3B8]">
                    ACTIVE ARCHIVE EPOCH:{' '}
                    <strong className="text-[#5EEAD4]">
                      {MONTH_NAMES[monthIndex - 1]} {archiveYear} ({activeDateStr})
                    </strong>
                  </span>

                  <div className="flex gap-1.5" role="group" aria-label="Onboarding Archive Year Switcher">
                    {ARCHIVE_YEARS.map((yr) => (
                      <button
                        key={yr}
                        type="button"
                        onClick={() => onChangeYear(yr)}
                        aria-pressed={archiveYear === yr}
                        className={`px-2.5 py-1 border text-xs font-mono-tabular cursor-pointer ${
                          archiveYear === yr
                            ? 'bg-[#5EEAD4] border-[#5EEAD4] text-[#060B14] font-semibold'
                            : 'bg-[#0B1320] border-[#1A2E44] text-[#94A3B8] hover:text-[#F1F5F9]'
                        }`}
                      >
                        {yr}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onScrubMonth(9)}
                    className="px-2.5 py-1 border border-[#FB7185] bg-[#111D30] text-[#FB7185] hover:bg-[#FB7185] hover:text-[#060B14] text-xs font-mono-tabular cursor-pointer whitespace-nowrap"
                  >
                    Jump to Sep {archiveYear} Minimum
                  </button>
                  <button
                    type="button"
                    onClick={() => onScrubMonth(latestMonth)}
                    className="px-2.5 py-1 border border-[#1A2E44] bg-[#0B1320] text-[#F1F5F9] hover:border-[#5EEAD4] text-xs font-mono-tabular cursor-pointer whitespace-nowrap"
                  >
                    Jump to {MONTH_NAMES[latestMonth - 1]} {archiveYear}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleProjection(projection === 'globe' ? 'plate' : 'globe')}
                    className="px-2.5 py-1 border border-[#1A2E44] bg-[#0B1320] text-[#5EEAD4] hover:border-[#5EEAD4] text-xs font-mono-tabular flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Globe className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>View: {projection === 'globe' ? '3D Globe' : 'EPSG:4326'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={onToggleAnomalyHeatmap}
                    aria-pressed={showAnomalyHeatmap}
                    className={`px-2.5 py-1 border text-xs font-mono-tabular flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                      showAnomalyHeatmap
                        ? 'bg-[#FB7185] border-[#FB7185] text-[#060B14] font-semibold'
                        : 'bg-[#0B1320] border-[#1A2E44] text-[#94A3B8] hover:text-[#F1F5F9] hover:border-[#FB7185]'
                    }`}
                  >
                    <Thermometer className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>D3 Anomaly Heatmap: {showAnomalyHeatmap ? 'ON' : 'OFF'}</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-sm text-[#F1F5F9] leading-relaxed">
                You can operate the entire observatory via keyboard or screen reader. Press{' '}
                <strong className="text-[#5EEAD4]">Space</strong> at any time to start or pause the
                3D binaural sequencer, use arrow keys to sweep around Earth, and enable optional
                spoken announcements below.
              </p>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs border border-[#1A2E44] bg-[#060B14] p-3">
                <div className="flex items-center justify-between border-b border-[#1A2E44] pb-1.5">
                  <dt className="font-mono-tabular text-[#5EEAD4]">Space / Enter</dt>
                  <dd className="text-[#94A3B8]">Start or Pause Audio</dd>
                </div>
                <div className="flex items-center justify-between border-b border-[#1A2E44] pb-1.5">
                  <dt className="font-mono-tabular text-[#5EEAD4]">← / → (Shift)</dt>
                  <dd className="text-[#94A3B8]">Rotate Head 90° (15° Fine)</dd>
                </div>
                <div className="flex items-center justify-between border-b border-[#1A2E44] pb-1.5">
                  <dt className="font-mono-tabular text-[#5EEAD4]">1 · 2 · 3 · 4</dt>
                  <dd className="text-[#94A3B8]">Snap N / E / S / W Cardinal</dd>
                </div>
                <div className="flex items-center justify-between border-b border-[#1A2E44] pb-1.5">
                  <dt className="font-mono-tabular text-[#5EEAD4]">M / A / H</dt>
                  <dd className="text-[#94A3B8]">Globe / D3 Heatmap / Status</dd>
                </div>
              </dl>

              <div className="border border-[#1A2E44] bg-[#060B14] p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
                  <Layers className="w-4 h-4 text-[#5EEAD4] shrink-0" aria-hidden="true" />
                  <span>
                    Optional Web Speech voice narration accompanies ARIA live telemetry updates.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onToggleSpeech}
                  aria-pressed={speechEnabled}
                  className={`px-3 py-1.5 border text-xs font-mono-tabular flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    speechEnabled
                      ? 'bg-[#111D30] border-[#5EEAD4] text-[#5EEAD4]'
                      : 'bg-[#0B1320] border-[#1A2E44] text-[#94A3B8] hover:text-[#F1F5F9]'
                  }`}
                >
                  <Speech className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Speech: {speechEnabled ? 'ON' : 'OFF'}</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* BOTTOM NAVIGATION FOOTER */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-[#1A2E44] bg-[#111D30]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => goToStep(step - 1)}
              disabled={step === 0}
              className="px-3 py-1.5 border border-[#1A2E44] bg-[#060B14] text-xs font-mono-tabular text-[#F1F5F9] hover:border-[#5EEAD4] disabled:opacity-40 cursor-pointer"
            >
              Previous
            </button>
            {step < STEP_TITLES.length - 1 && (
              <button
                type="button"
                onClick={() => goToStep(step + 1)}
                className="px-4 py-1.5 border border-[#5EEAD4] bg-[#5EEAD4] text-[#060B14] text-xs font-mono-tabular font-semibold hover:bg-[#99f6e4] cursor-pointer"
              >
                Next Step
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onClose(false)}
              className="px-3 py-1.5 border border-[#1A2E44] bg-[#060B14] text-xs font-mono-tabular text-[#94A3B8] hover:text-[#F1F5F9] hover:border-[#5EEAD4] cursor-pointer whitespace-nowrap"
            >
              Enter Without Audio
            </button>
            <button
              type="button"
              onClick={() => onClose(!isPlaying)}
              className="px-4 py-1.5 border border-[#5EEAD4] bg-[#5EEAD4] text-[#060B14] text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 hover:bg-[#99f6e4] cursor-pointer whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isPlaying ? 'Return to Observatory' : 'Start Audio & Enter'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
