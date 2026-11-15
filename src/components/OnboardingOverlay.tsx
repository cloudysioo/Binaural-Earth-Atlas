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
  nightMode?: boolean;
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
  nightMode = false,
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: nightMode ? 'rgba(7, 1, 2, 0.88)' : 'rgba(6, 11, 20, 0.85)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-heading"
      aria-describedby="onboarding-body"
    >
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto border border-[var(--accent-mint)] bg-[var(--bg-console)] text-[var(--text-primary)] flex flex-col">
        {/* TOP DIALOG BAR */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-[var(--border-grid)] bg-[var(--bg-panel)]">
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandLogo size={24} nightMode={nightMode} />
            <span className="text-xs font-mono-tabular text-[var(--accent-mint)] font-semibold whitespace-nowrap">
              STEP 0{step + 1} / 04
            </span>
            <h2
              id="onboarding-heading"
              className="text-sm font-semibold text-[var(--text-primary)] truncate"
            >
              {STEP_TITLES[step]}
            </h2>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            onClick={() => onClose(false)}
            aria-label="Close onboarding guide"
            className="px-2 py-1 border border-[var(--border-grid)] bg-[var(--bg-obsidian)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent-mint)] text-xs font-mono-tabular flex items-center gap-1 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Skip</span>
          </button>
        </div>

        {/* STEP PROGRESS TABS */}
        <nav
          aria-label="Onboarding Steps"
          className="grid grid-cols-2 sm:grid-cols-4 border-b border-[var(--border-grid)] bg-[var(--bg-obsidian)] text-[11px] font-mono-tabular"
        >
          {STEP_TITLES.map((title, idx) => {
            const isCurrent = step === idx;
            return (
              <button
                key={title}
                type="button"
                onClick={() => goToStep(idx)}
                aria-current={isCurrent ? 'step' : undefined}
                className={`px-3 py-2 border-r border-b sm:border-b-0 border-[var(--border-grid)] text-left cursor-pointer truncate ${
                  isCurrent
                    ? 'bg-[var(--bg-panel)] text-[var(--accent-mint)] font-semibold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
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
              <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                <strong>Binaural Earth Atlas</strong> places four live NASA Earth observation streams
                at the four cardinal directions around your head using Web Audio{' '}
                <strong className="text-[var(--accent-mint)]">3D HRTF spatial panning</strong>. Rotating your
                spatial heading shifts which planetary system sits directly in front of you at{' '}
                <strong className="text-[var(--accent-mint)]">100% focus weight</strong>, while lateral and
                rear layers remain softly present at <strong className="text-[var(--text-muted)]">45%</strong>{' '}
                so you hear global contrast in stereo space.
              </p>

              {/* LIVE HEADING & CARDINAL FOCUS TABLE */}
              <div className="border border-[var(--border-grid)] bg-[var(--bg-obsidian)] p-3 flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-mono-tabular">
                    <Headphones className="w-4 h-4 text-[var(--accent-mint)]" aria-hidden="true" />
                    <span className="text-[var(--text-muted)]">CURRENT HEADING:</span>
                    <strong className="text-[var(--accent-mint)]">
                      {String(Math.round(listenerAngle)).padStart(3, '0')}° ({activeLayer.cardinal.toUpperCase()})
                    </strong>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onRotateStep(-45)}
                      className="px-2 py-1 border border-[var(--border-grid)] bg-[var(--bg-console)] text-[var(--text-primary)] hover:border-[var(--accent-mint)] text-xs font-mono-tabular cursor-pointer whitespace-nowrap"
                    >
                      Rotate -45°
                    </button>
                    <button
                      type="button"
                      onClick={() => onRotateStep(45)}
                      className="px-2 py-1 border border-[var(--border-grid)] bg-[var(--bg-console)] text-[var(--text-primary)] hover:border-[var(--accent-mint)] text-xs font-mono-tabular cursor-pointer whitespace-nowrap"
                    >
                      Rotate +45°
                    </button>
                    <button
                      type="button"
                      onClick={onTestSpatialAudio}
                      disabled={isTestingSpatial}
                      className="px-2.5 py-1 border border-[var(--accent-mint)] bg-[var(--bg-panel)] text-[var(--accent-mint)] hover:bg-[var(--accent-mint)] hover:text-[var(--bg-obsidian)] disabled:opacity-60 text-xs font-mono-tabular flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
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
                            ? 'border-[var(--accent-mint)] bg-[var(--bg-panel)]'
                            : 'border-[var(--border-grid)] bg-[var(--bg-console)] hover:border-[var(--accent-mint)]'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs font-mono-tabular">
                          <span className={isFocused ? 'text-[var(--accent-mint)] font-semibold' : 'text-[var(--text-primary)] font-semibold'}>
                            {meta.azimuthLabel} {meta.cardinal.toUpperCase()} · {meta.domain.toUpperCase()}
                          </span>
                          <span className="text-[var(--accent-mint)]">{focusPct}% FOCUS</span>
                        </div>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">
                          {meta.phenomenon} · {meta.waveformDescription}
                        </div>
                        <div className="mt-1.5 h-1 w-full bg-[var(--bg-obsidian)] border border-[var(--border-grid)]">
                          <div
                            className="h-full bg-[var(--accent-mint)]"
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
              <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                Every NASA GIBS satellite frame is analyzed into <strong className="text-[var(--accent-mint)]">6 normalized telemetry signals</strong> that drive real-time synthesis for each direction. As planetary conditions shift across seasons and headings, the timbre, pitch, rhythm, and harmonic tension respond directly:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="border border-[var(--border-grid)] bg-[var(--bg-obsidian)] p-3">
                  <div className="text-xs font-mono-tabular text-[var(--accent-mint)] font-semibold">
                    01. BRIGHTNESS → PITCH REGISTER
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    High-albedo polar ice and bright blooms lift pitch octave. Current{' '}
                    {activeLayer.cardinal}: <strong className="text-[var(--text-primary)]">{activeFreq.toFixed(0)} Hz</strong>.
                  </p>
                </div>

                <div className="border border-[var(--border-grid)] bg-[var(--bg-obsidian)] p-3">
                  <div className="text-xs font-mono-tabular text-[var(--accent-mint)] font-semibold">
                    02. HUE ANGLE → SCALE DEGREE
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Dominant spectral hue maps across quantized musical degrees so color gradients sing smoothly.
                  </p>
                </div>

                <div className="border border-[var(--border-grid)] bg-[var(--bg-obsidian)] p-3">
                  <div className="text-xs font-mono-tabular text-[var(--accent-mint)] font-semibold">
                    03. SATURATION → FILTER BRIGHTNESS
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Vivid chlorophyll or thermal plumes open the lowpass filter up to{' '}
                    <strong className="text-[var(--text-primary)]">{activeFilterHz} Hz</strong>.
                  </p>
                </div>

                <div className="border border-[var(--border-grid)] bg-[var(--bg-obsidian)] p-3">
                  <div className="text-xs font-mono-tabular text-[var(--accent-mint)] font-semibold">
                    04. EDGE DENSITY → PULSE SUBDIVISION
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Sharp coastlines, fronts, and fractured ice trigger <strong className="text-[var(--text-primary)]">1× / 2× / 3×</strong> rhythmic subdivisions.
                  </p>
                </div>

                <div className="border border-[var(--border-grid)] bg-[var(--bg-obsidian)] p-3">
                  <div className="text-xs font-mono-tabular text-[var(--accent-mint)] font-semibold">
                    05. FRAME MOTION → SEQUENCER TEMPO
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Month-to-month satellite variance accelerates archive playback between{' '}
                    <strong className="text-[var(--text-primary)]">2500 ms</strong> and <strong className="text-[var(--text-primary)]">1500 ms</strong>.
                  </p>
                </div>

                <div className="border border-[var(--accent-coral)] bg-[var(--bg-obsidian)] p-3">
                  <div className="text-xs font-mono-tabular text-[var(--accent-coral)] font-semibold">
                    06. CLIMATE ANOMALY → DETUNED TENSION
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Statistical &gt;2σ thermal &amp; ice departures blend a detuned secondary oscillator. Current:{' '}
                    <strong className="text-[var(--accent-coral)]">{activeAnomalyPct}%</strong>.
                  </p>
                </div>
              </div>

              <div className="border border-[var(--border-grid)] bg-[var(--bg-obsidian)] p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-mono-tabular text-[var(--text-muted)]">
                  <Sliders className="w-3.5 h-3.5 text-[var(--accent-mint)]" aria-hidden="true" />
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
                          ? 'bg-[var(--accent-mint)] border-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                          : 'bg-[var(--bg-console)] border-[var(--border-grid)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
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
              <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                Navigate across <strong className="text-[var(--accent-mint)]">2026 live orbital passes</strong>,{' '}
                <strong>2025</strong>, or the historic <strong>2007</strong> Arctic minimum baseline.
                Drag the <strong>3D Orthographic Globe</strong> to orbit, switch to{' '}
                <strong>EPSG:4326</strong> Plate Carrée, hover any coordinate to inspect point{' '}
                <strong className="text-[var(--accent-mint)]">Anomaly Intensity %</strong>, or toggle the{' '}
                <strong className="text-[var(--accent-coral)]">D3 Climate Anomaly Heatmap</strong> to visualize
                global temperature variance (<code className="font-mono-tabular">ΔT °C</code>).
              </p>

              <div className="border border-[var(--border-grid)] bg-[var(--bg-obsidian)] p-3 flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-mono-tabular text-[var(--text-muted)]">
                    ACTIVE ARCHIVE EPOCH:{' '}
                    <strong className="text-[var(--accent-mint)]">
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
                            ? 'bg-[var(--accent-mint)] border-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                            : 'bg-[var(--bg-console)] border-[var(--border-grid)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
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
                    className="px-2.5 py-1 border border-[var(--accent-coral)] bg-[var(--bg-panel)] text-[var(--accent-coral)] hover:bg-[var(--accent-coral)] hover:text-[var(--bg-obsidian)] text-xs font-mono-tabular cursor-pointer whitespace-nowrap"
                  >
                    Jump to Sep {archiveYear} Minimum
                  </button>
                  <button
                    type="button"
                    onClick={() => onScrubMonth(latestMonth)}
                    className="px-2.5 py-1 border border-[var(--border-grid)] bg-[var(--bg-console)] text-[var(--text-primary)] hover:border-[var(--accent-mint)] text-xs font-mono-tabular cursor-pointer whitespace-nowrap"
                  >
                    Jump to {MONTH_NAMES[latestMonth - 1]} {archiveYear}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleProjection(projection === 'globe' ? 'plate' : 'globe')}
                    className="px-2.5 py-1 border border-[var(--border-grid)] bg-[var(--bg-console)] text-[var(--accent-mint)] hover:border-[var(--accent-mint)] text-xs font-mono-tabular flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
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
                        ? 'bg-[var(--accent-coral)] border-[var(--accent-coral)] text-[var(--bg-obsidian)] font-semibold'
                        : 'bg-[var(--bg-console)] border-[var(--border-grid)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent-coral)]'
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
              <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                You can operate the entire observatory via keyboard or screen reader. Press{' '}
                <strong className="text-[var(--accent-mint)]">Space</strong> at any time to start or pause the
                3D binaural sequencer, use arrow keys to sweep around Earth, and enable optional
                spoken announcements below.
              </p>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs border border-[var(--border-grid)] bg-[var(--bg-obsidian)] p-3">
                <div className="flex items-center justify-between border-b border-[var(--border-grid)] pb-1.5">
                  <dt className="font-mono-tabular text-[var(--accent-mint)]">Space / Enter</dt>
                  <dd className="text-[var(--text-muted)]">Start or Pause Audio</dd>
                </div>
                <div className="flex items-center justify-between border-b border-[var(--border-grid)] pb-1.5">
                  <dt className="font-mono-tabular text-[var(--accent-mint)]">← / → (Shift)</dt>
                  <dd className="text-[var(--text-muted)]">Rotate Head 90° (15° Fine)</dd>
                </div>
                <div className="flex items-center justify-between border-b border-[var(--border-grid)] pb-1.5">
                  <dt className="font-mono-tabular text-[var(--accent-mint)]">1 · 2 · 3 · 4</dt>
                  <dd className="text-[var(--text-muted)]">Snap N / E / S / W Cardinal</dd>
                </div>
                <div className="flex items-center justify-between border-b border-[var(--border-grid)] pb-1.5">
                  <dt className="font-mono-tabular text-[var(--accent-mint)]">M / A / T / R / N</dt>
                  <dd className="text-[var(--text-muted)]">Globe / Heatmap / Solar / Reverb / Night</dd>
                </div>
              </dl>

              <div className="border border-[var(--border-grid)] bg-[var(--bg-obsidian)] p-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <Layers className="w-4 h-4 text-[var(--accent-mint)] shrink-0" aria-hidden="true" />
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
                      ? 'bg-[var(--bg-panel)] border-[var(--accent-mint)] text-[var(--accent-mint)]'
                      : 'bg-[var(--bg-console)] border-[var(--border-grid)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
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
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-[var(--border-grid)] bg-[var(--bg-panel)]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => goToStep(step - 1)}
              disabled={step === 0}
              className="px-3 py-1.5 border border-[var(--border-grid)] bg-[var(--bg-obsidian)] text-xs font-mono-tabular text-[var(--text-primary)] hover:border-[var(--accent-mint)] disabled:opacity-40 cursor-pointer"
            >
              Previous
            </button>
            {step < STEP_TITLES.length - 1 && (
              <button
                type="button"
                onClick={() => goToStep(step + 1)}
                className="px-4 py-1.5 border border-[var(--accent-mint)] bg-[var(--accent-mint)] text-[var(--bg-obsidian)] text-xs font-mono-tabular font-semibold hover:opacity-90 cursor-pointer"
              >
                Next Step
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onClose(false)}
              className="px-3 py-1.5 border border-[var(--border-grid)] bg-[var(--bg-obsidian)] text-xs font-mono-tabular text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent-mint)] cursor-pointer whitespace-nowrap"
            >
              Enter Without Audio
            </button>
            <button
              type="button"
              onClick={() => onClose(!isPlaying)}
              className="px-4 py-1.5 border border-[var(--accent-mint)] bg-[var(--accent-mint)] text-[var(--bg-obsidian)] text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 hover:opacity-90 cursor-pointer whitespace-nowrap"
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
