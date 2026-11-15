import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HelpCircle, Pause, Play, Radio, Speech, Volume2, VolumeX } from 'lucide-react';
import { extractFeatureVector, resetFeatureVectorCache } from './analysis/featureVector';
import {
  ANALYSIS_HEIGHT,
  ANALYSIS_WIDTH,
  loadGIBSFrame,
  renderProceduralFrame,
} from './analysis/pixelScanner';
import { AudioEngine } from './audio/audioEngine';
import { quantizeToPentatonic, SCALE_DEFINITIONS, ScaleMode } from './audio/scales';
import { AudioSpectrumBar } from './components/AudioSpectrumBar';
import { BrandLogo } from './components/BrandLogo';
import { OnboardingOverlay } from './components/OnboardingOverlay';
import { RadarCompassHud } from './components/RadarCompassHud';
import { ProjectionMode, SatelliteMapCanvas } from './components/SatelliteMapCanvas';
import { TemporalTrendsChart } from './components/TemporalTrendsChart';
import {
  ARCHIVE_YEARS,
  ArchiveYear,
  azimuthToLayerKey,
  EMPTY_FEATURE_VECTOR,
  FeatureVector,
  formatArchiveDate,
  getMaxMonthForYear,
  getSeasonalBenchmarks,
  LAYER_ORDER,
  LayerKey,
  LogEntry,
  MONTH_NAMES,
  NASA_GIBS_LAYERS,
  TelemetryPoint,
} from './types/bea';
import { AccessibilityAnnouncer } from './ui/announcer';
import { useKeyboardControls } from './ui/useKeyboardControls';

type ReferenceTab = 'log' | 'manual' | 'specs';

function createOffscreenCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = ANALYSIS_WIDTH;
  c.height = ANALYSIS_HEIGHT;
  return c;
}

function getUtcClockString(): string {
  return new Date().toISOString().slice(11, 19) + ' UTC';
}

const ONBOARDING_STORAGE_KEY = 'bea_onboarding_completed_v1';

function hasCompletedOnboarding(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function App() {
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const announcerRef = useRef<AccessibilityAnnouncer | null>(null);
  const ariaLiveElRef = useRef<HTMLDivElement | null>(null);
  const guideButtonRef = useRef<HTMLButtonElement | null>(null);

  const offscreenMapRef = useRef<Record<LayerKey, HTMLCanvasElement> | null>(null);
  if (!offscreenMapRef.current) {
    offscreenMapRef.current = {
      north: createOffscreenCanvas(),
      east: createOffscreenCanvas(),
      south: createOffscreenCanvas(),
      west: createOffscreenCanvas(),
    };
  }

  const sequencerTimerRef = useRef<number | null>(null);
  const isLoadingRef = useRef<boolean>(false);
  const isPlayingRef = useRef<boolean>(false);
  const archiveYearRef = useRef<ArchiveYear>(2026);
  const monthIndexRef = useRef<number>(11);
  const activeLayerRef = useRef<LayerKey>('north');

  const [utcClock, setUtcClock] = useState<string>(() => getUtcClockString());
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isTestingSpatial, setIsTestingSpatial] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [archiveYear, setArchiveYear] = useState<ArchiveYear>(2026);
  const [monthIndex, setMonthIndex] = useState<number>(11);
  const [listenerAngle, setListenerAngle] = useState<number>(0);
  const [activeLayerKey, setActiveLayerKey] = useState<LayerKey>('north');
  const [masterVolume, setMasterVolume] = useState<number>(0.72);
  const [speechEnabled, setSpeechEnabled] = useState<boolean>(false);
  const [scaleMode, setScaleMode] = useState<ScaleMode>('pentatonic');
  const [projection, setProjection] = useState<ProjectionMode>('globe');
  const [showAnomalyHeatmap, setShowAnomalyHeatmap] = useState<boolean>(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(() => !hasCompletedOnboarding());
  const [activeTab, setActiveTab] = useState<ReferenceTab>('log');
  const [cadenceMs, setCadenceMs] = useState<number>(2000);
  const [dataSource, setDataSource] = useState<string>('NASA GIBS WMTS');
  const [frameRevision, setFrameRevision] = useState<number>(0);

  const [vectors, setVectors] = useState<Record<LayerKey, FeatureVector>>({
    north: { ...EMPTY_FEATURE_VECTOR },
    east: { ...EMPTY_FEATURE_VECTOR },
    south: { ...EMPTY_FEATURE_VECTOR },
    west: { ...EMPTY_FEATURE_VECTOR },
  });

  const [frequencies, setFrequencies] = useState<Record<LayerKey, number>>({
    north: 220,
    east: 220,
    south: 220,
    west: 220,
  });

  const [history, setHistory] = useState<TelemetryPoint[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: 'boot-1',
      timestamp: getUtcClockString().slice(0, 8),
      message: 'ORBITAL ACOUSTICS OBSERVATORY READY · SYNCING 2026-11-12 LIVE NASA GIBS',
      tone: 'mint',
    },
    {
      id: 'boot-2',
      timestamp: getUtcClockString().slice(0, 8),
      message: 'AUTOPLAY POLICY ARMED · PRESS SPACE OR START AUDIO TO INITIALIZE HRTF',
      tone: 'info',
    },
  ]);

  const appendLog = useCallback((message: string, tone: LogEntry['tone'] = 'info') => {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString().slice(11, 19),
      message,
      tone,
    };
    setLogs((prev) => [entry, ...prev].slice(0, 40));
  }, []);

  useEffect(() => {
    audioEngineRef.current = new AudioEngine();
    announcerRef.current = new AccessibilityAnnouncer();
    announcerRef.current.attachElement(ariaLiveElRef.current);

    const clockInterval = window.setInterval(() => {
      setUtcClock(getUtcClockString());
    }, 1000);

    return () => {
      window.clearInterval(clockInterval);
      if (sequencerTimerRef.current !== null) {
        window.clearTimeout(sequencerTimerRef.current);
      }
      audioEngineRef.current?.dispose();
      announcerRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    activeLayerRef.current = activeLayerKey;
  }, [activeLayerKey]);

  const recomputeFrequencies = useCallback(
    (vecs: Record<LayerKey, FeatureVector>, mode: ScaleMode): Record<LayerKey, number> => {
      return {
        north: quantizeToPentatonic(vecs.north.hue, vecs.north.brightness, mode).frequency,
        east: quantizeToPentatonic(vecs.east.hue, vecs.east.brightness, mode).frequency,
        south: quantizeToPentatonic(vecs.south.hue, vecs.south.brightness, mode).frequency,
        west: quantizeToPentatonic(vecs.west.hue, vecs.west.brightness, mode).frequency,
      };
    },
    []
  );

  const ingestMonth = useCallback(
    async (targetYear: ArchiveYear, targetMonth: number, updateAudio: boolean): Promise<number> => {
      if (isLoadingRef.current) return 2000;
      isLoadingRef.current = true;
      setIsLoading(true);

      const dateStr = formatArchiveDate(targetYear, targetMonth);
      const canvases = offscreenMapRef.current!;
      const nextVectors = {} as Record<LayerKey, FeatureVector>;
      let primarySource = 'Procedural Earth Model';

      try {
        const results = await Promise.all(
          LAYER_ORDER.map(async (key) => {
            const res = await loadGIBSFrame(key, dateStr, canvases[key]);
            const vec = extractFeatureVector(res.canvas, key);
            return { key, res, vec };
          })
        );

        for (const item of results) {
          nextVectors[item.key] = item.vec;
          if (item.key === activeLayerRef.current) {
            primarySource = item.res.source;
          }
        }

        const currentLayerVec = nextVectors[activeLayerRef.current];
        const nextCadence = Math.round(2500 - currentLayerVec.motion * 1000);

        setVectors(nextVectors);
        setDataSource(primarySource);
        setCadenceMs(nextCadence);
        setArchiveYear(targetYear);
        archiveYearRef.current = targetYear;
        setMonthIndex(targetMonth);
        monthIndexRef.current = targetMonth;
        setFrameRevision((r) => r + 1);

        const nextFreqs = recomputeFrequencies(nextVectors, scaleMode);
        setFrequencies(nextFreqs);

        if (updateAudio && audioEngineRef.current?.isRunning()) {
          audioEngineRef.current.updateAllLayers(nextVectors, nextCadence);
        }

        const intensity = Number(
          ((currentLayerVec.brightness + currentLayerVec.saturation) / 2).toFixed(3)
        );
        const anomaly = Number(currentLayerVec.climateAnomaly.toFixed(3));
        const label = MONTH_NAMES[targetMonth - 1];

        setHistory((prev) => {
          const filtered = prev.filter((p) => p.monthIndex !== targetMonth);
          return [
            ...filtered,
            {
              monthIndex: targetMonth,
              label,
              dateStr,
              intensity,
              anomaly,
            },
          ].sort((a, b) => a.monthIndex - b.monthIndex);
        });

        if (targetMonth === 9) {
          appendLog(
            `${dateStr} BENCHMARK · ARCTIC SUMMER MINIMUM · ANOMALY ${(anomaly * 100).toFixed(1)}%`,
            'coral'
          );
        } else {
          appendLog(
            `INGESTED ${dateStr} · ${primarySource.toUpperCase()} · CADENCE ${nextCadence}MS`,
            'info'
          );
        }

        return nextCadence;
      } finally {
        isLoadingRef.current = false;
        setIsLoading(false);
      }
    },
    [appendLog, recomputeFrequencies, scaleMode]
  );

  // Silent visual bootstrap on latest November 2026 NASA GIBS pass (no AudioContext created)
  useEffect(() => {
    const initialDate = formatArchiveDate(2026, 11);
    const canvases = offscreenMapRef.current!;
    for (const key of LAYER_ORDER) {
      renderProceduralFrame(canvases[key], key, initialDate);
    }
    void ingestMonth(2026, 11, false);
  }, [ingestMonth]);

  const scheduleNextTick = useCallback(
    (delayMs: number) => {
      if (sequencerTimerRef.current !== null) {
        window.clearTimeout(sequencerTimerRef.current);
      }
      if (!isPlayingRef.current) return;

      sequencerTimerRef.current = window.setTimeout(async () => {
        if (!isPlayingRef.current) return;
        const yr = archiveYearRef.current;
        const maxM = getMaxMonthForYear(yr);
        const nextMonth = monthIndexRef.current >= maxM ? 1 : monthIndexRef.current + 1;
        const nextCadence = await ingestMonth(yr, nextMonth, true);
        if (isPlayingRef.current) {
          scheduleNextTick(nextCadence);
        }
      }, delayMs);
    },
    [ingestMonth]
  );

  const handleTogglePlay = useCallback(async () => {
    const engine = audioEngineRef.current;
    if (!engine) return;

    if (isPlayingRef.current) {
      if (sequencerTimerRef.current !== null) {
        window.clearTimeout(sequencerTimerRef.current);
        sequencerTimerRef.current = null;
      }
      engine.stop();
      setIsPlaying(false);
      isPlayingRef.current = false;
      appendLog('SONIFICATION PAUSED · SEQUENCER HALTED', 'warn');
      announcerRef.current?.announceImmediate('Sonification paused. Sequencer halted.');
    } else {
      await engine.start();
      setIsPlaying(true);
      isPlayingRef.current = true;
      const layer = NASA_GIBS_LAYERS[activeLayerRef.current];
      appendLog(
        `3D HRTF ONLINE · HEADING ${String(Math.round(listenerAngle)).padStart(3, '0')}° (${layer.cardinal.toUpperCase()})`,
        'mint'
      );
      announcerRef.current?.announceImmediate(
        `Audio engine online. Sequencer started. Facing ${layer.cardinal} at ${Math.round(
          listenerAngle
        )} degrees. Active observation: ${layer.phenomenon}.`
      );
      const nextCadence = await ingestMonth(
        archiveYearRef.current,
        monthIndexRef.current,
        true
      );
      if (isPlayingRef.current) {
        scheduleNextTick(nextCadence);
      }
    }
  }, [appendLog, ingestMonth, listenerAngle, scheduleNextTick]);

  const handleTestSpatialAudio = useCallback(async () => {
    const engine = audioEngineRef.current;
    if (!engine || isTestingSpatial) return;

    await engine.initOnUserGesture();
    setIsTestingSpatial(true);
    appendLog('CALIBRATION SWEEP: NORTH -> EAST -> SOUTH -> WEST', 'mint');
    announcerRef.current?.announceImmediate(
      'Running 3D spatial audio sweep. North front, East right, South behind, West left.'
    );

    await engine.testSpatialAudio(
      (key) => {
        const meta = NASA_GIBS_LAYERS[key];
        appendLog(`HRTF PING: ${meta.cardinal.toUpperCase()} (${meta.azimuthLabel})`, 'info');
      },
      () => {
        setIsTestingSpatial(false);
        appendLog('HRTF CALIBRATION SWEEP COMPLETE', 'mint');
      }
    );
  }, [appendLog, isTestingSpatial]);

  const handleSetHeading = useCallback(
    (rawAngleDeg: number, customAnnouncement?: string) => {
      const normalized = ((Math.round(rawAngleDeg) % 360) + 360) % 360;
      const nearestKey = azimuthToLayerKey(normalized);
      const meta = NASA_GIBS_LAYERS[nearestKey];

      setListenerAngle(normalized);
      setActiveLayerKey(nearestKey);
      activeLayerRef.current = nearestKey;
      audioEngineRef.current?.setHeading(normalized);

      const vec = vectors[nearestKey];
      if (vec) {
        setCadenceMs(Math.round(2500 - vec.motion * 1000));
      }

      setFrameRevision((r) => r + 1);
      appendLog(
        `HEADING ${String(normalized).padStart(3, '0')}° · FOCUS ${meta.cardinal.toUpperCase()} (${meta.domain.toUpperCase()})`,
        'mint'
      );
      announcerRef.current?.announce(
        customAnnouncement ??
          `Facing ${normalized} degrees, ${meta.cardinal}. Active observation: ${meta.phenomenon}.`
      );
    },
    [appendLog, vectors]
  );

  const handleSelectLayer = useCallback(
    (targetKey: LayerKey) => {
      const meta = NASA_GIBS_LAYERS[targetKey];
      handleSetHeading(
        meta.azimuth,
        `Facing ${meta.cardinal} at ${meta.azimuth} degrees. Active observation: ${meta.phenomenon}.`
      );
    },
    [handleSetHeading]
  );

  const handleRotateLeft = useCallback(
    (stepDeg: number) => {
      handleSetHeading(listenerAngle - stepDeg);
    },
    [handleSetHeading, listenerAngle]
  );

  const handleRotateRight = useCallback(
    (stepDeg: number) => {
      handleSetHeading(listenerAngle + stepDeg);
    },
    [handleSetHeading, listenerAngle]
  );

  const handleRequestStatus = useCallback(() => {
    const meta = NASA_GIBS_LAYERS[activeLayerRef.current];
    const dateStr = formatArchiveDate(archiveYearRef.current, monthIndexRef.current);
    const vec = vectors[activeLayerRef.current];
    const anomalyPct = Math.round((vec?.climateAnomaly ?? 0) * 100);
    const msg = `Heading ${Math.round(listenerAngle)} degrees, ${meta.cardinal}. Active layer ${
      meta.phenomenon
    }. Observation date ${dateStr}. Climate anomaly ${anomalyPct} percent.`;
    announcerRef.current?.announceImmediate(msg);
    appendLog(`STATUS QUERY · ${Math.round(listenerAngle)}° · ${dateStr}`, 'info');
  }, [appendLog, listenerAngle, vectors]);

  const handleScrubMonth = useCallback(
    async (targetMonth: number) => {
      const yr = archiveYearRef.current;
      const maxM = getMaxMonthForYear(yr);
      const clamped = Math.max(1, Math.min(maxM, targetMonth));
      if (sequencerTimerRef.current !== null) {
        window.clearTimeout(sequencerTimerRef.current);
        sequencerTimerRef.current = null;
      }
      monthIndexRef.current = clamped;
      setMonthIndex(clamped);

      const dateStr = formatArchiveDate(yr, clamped);
      announcerRef.current?.announce(`Observation date ${dateStr}.`);
      const nextCadence = await ingestMonth(yr, clamped, isPlayingRef.current);
      if (isPlayingRef.current) {
        scheduleNextTick(nextCadence);
      }
    },
    [ingestMonth, scheduleNextTick]
  );

  const handleChangeYear = useCallback(
    async (targetYear: ArchiveYear) => {
      if (sequencerTimerRef.current !== null) {
        window.clearTimeout(sequencerTimerRef.current);
        sequencerTimerRef.current = null;
      }
      resetFeatureVectorCache();
      setHistory([]);
      archiveYearRef.current = targetYear;
      setArchiveYear(targetYear);

      const maxM = getMaxMonthForYear(targetYear);
      const nextMonth = targetYear === 2026 ? 11 : Math.min(monthIndexRef.current, maxM);
      monthIndexRef.current = nextMonth;
      setMonthIndex(nextMonth);

      const dateStr = formatArchiveDate(targetYear, nextMonth);
      appendLog(`EPOCH SWITCH -> ${targetYear} ARCHIVE (${dateStr})`, 'mint');
      announcerRef.current?.announce(`Switched archive year to ${targetYear}. Date ${dateStr}.`);

      const nextCadence = await ingestMonth(targetYear, nextMonth, isPlayingRef.current);
      if (isPlayingRef.current) {
        scheduleNextTick(nextCadence);
      }
    },
    [appendLog, ingestMonth, scheduleNextTick]
  );

  const handleScaleModeChange = (mode: ScaleMode) => {
    setScaleMode(mode);
    audioEngineRef.current?.setScaleMode(mode);
    const nextFreqs = recomputeFrequencies(vectors, mode);
    setFrequencies(nextFreqs);
    if (audioEngineRef.current?.isRunning()) {
      audioEngineRef.current.updateAllLayers(vectors, cadenceMs);
    }
    appendLog(`HARMONIC SCALE -> ${SCALE_DEFINITIONS[mode].label.toUpperCase()}`, 'mint');
    announcerRef.current?.announce(`Scale changed to ${SCALE_DEFINITIONS[mode].label}.`);
  };

  const handleVolumeChange = (val: number) => {
    setMasterVolume(val);
    audioEngineRef.current?.setMasterVolume(val);
  };

  const handleToggleSpeech = () => {
    const next = !speechEnabled;
    setSpeechEnabled(next);
    announcerRef.current?.setSpeechEnabled(next);
    if (next) {
      const meta = NASA_GIBS_LAYERS[activeLayerKey];
      announcerRef.current?.announceImmediate(
        `Built-in speech output enabled. Facing ${meta.cardinal} at ${Math.round(
          listenerAngle
        )} degrees.`
      );
    }
  };

  const handleToggleAnomalyHeatmap = useCallback(() => {
    setShowAnomalyHeatmap((prev) => {
      const next = !prev;
      appendLog(
        `D3 CLIMATE ANOMALY HEATMAP ${next ? 'ENABLED' : 'DISABLED'} · ${formatArchiveDate(
          archiveYearRef.current,
          monthIndexRef.current
        )}`,
        next ? 'coral' : 'info'
      );
      announcerRef.current?.announceImmediate(
        `Climate Anomaly Heatmap overlay ${next ? 'enabled' : 'disabled'}.`
      );
      return next;
    });
  }, [appendLog]);

  const handleCloseOnboarding = useCallback(
    (startAudioAfter = false) => {
      try {
        window.localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
      } catch {
        // Ignore storage restrictions
      }
      setIsOnboardingOpen(false);
      appendLog('ONBOARDING GUIDE COMPLETED · OBSERVATORY CONTROLS ARMED', 'mint');
      if (startAudioAfter && !isPlayingRef.current) {
        void handleTogglePlay();
      } else {
        announcerRef.current?.announceImmediate('Onboarding guide closed.');
        window.setTimeout(() => {
          guideButtonRef.current?.focus();
        }, 20);
      }
    },
    [appendLog, handleTogglePlay]
  );

  const handleAnnounceOnboardingStep = useCallback((msg: string) => {
    announcerRef.current?.announceImmediate(msg);
  }, []);

  useKeyboardControls({
    disabled: isOnboardingOpen,
    onTogglePlay: () => {
      void handleTogglePlay();
    },
    onRotateLeft: handleRotateLeft,
    onRotateRight: handleRotateRight,
    onSelectCardinal: handleSelectLayer,
    onRequestStatus: handleRequestStatus,
    onToggleProjection: () => {
      setProjection((prev) => (prev === 'globe' ? 'plate' : 'globe'));
    },
    onToggleAnomalyHeatmap: handleToggleAnomalyHeatmap,
  });

  const activeLayer = NASA_GIBS_LAYERS[activeLayerKey];
  const activeVector = vectors[activeLayerKey];
  const activeDateStr = formatArchiveDate(archiveYear, monthIndex);
  const maxMonth = getMaxMonthForYear(archiveYear);
  const benchmarks = getSeasonalBenchmarks(archiveYear);
  const activeCanvas = offscreenMapRef.current?.[activeLayerKey] ?? null;
  const sstCanvas = offscreenMapRef.current?.south ?? null;
  const activePitchHz = frequencies[activeLayerKey] ?? 220;
  const activeFilterHz = Math.round(400 + activeVector.saturation * 5600);
  const activeNoteDegree = Math.floor(activeVector.hue * 9.99) + 1;

  const signalRows = [
    {
      label: 'Brightness',
      value: activeVector.brightness,
      target: `${activePitchHz.toFixed(0)} Hz Register`,
      isCoral: false,
    },
    {
      label: 'Hue Angle',
      value: activeVector.hue,
      target: `Scale Degree #${activeNoteDegree}`,
      isCoral: false,
    },
    {
      label: 'Saturation',
      value: activeVector.saturation,
      target: `LPF ${activeFilterHz} Hz`,
      isCoral: false,
    },
    {
      label: 'Edge Density',
      value: activeVector.edgeDensity,
      target:
        activeVector.edgeDensity > 0.65
          ? '3× Pulse Density'
          : activeVector.edgeDensity > 0.35
          ? '2× Pulse Density'
          : '1× Pulse Density',
      isCoral: false,
    },
    {
      label: 'Frame Motion',
      value: activeVector.motion,
      target: `${cadenceMs} ms Tempo`,
      isCoral: false,
    },
    {
      label: 'Climate Anomaly',
      value: activeVector.climateAnomaly,
      target: `${Math.round(activeVector.climateAnomaly * 100)}% Tension`,
      isCoral: true,
    },
  ];

  const getMonthlyClimateBrief = (yr: ArchiveYear, m: number): string => {
    if (yr >= 2025) {
      if (yr === 2026 && m === 11) {
        return 'November 2026 Live NASA Pass: Delayed Arctic autumn refreeze coincides with warm North Atlantic anomalies, active subpolar chlorophyll fronts, and late-autumn tropical Pacific SST transitions.';
      }
      if (m === 9) {
        return `September ${yr} Polar Minimum: Contemporary Arctic sea ice reaches its annual late-summer retreat, exposing broad open-water heat fluxes across the Beaufort, Chukchi, and Laptev seas.`;
      }
      if (m === 3) {
        return `March ${yr} Cryosphere Peak: Annual Northern Hemisphere sea ice reaches winter maximum prior to spring solar insolation and rapid melt-pond albedo onset.`;
      }
      if (m >= 6 && m <= 8) {
        return `Boreal Summer ${yr}: Peak terrestrial NDVI vegetation productivity aligns with high-latitude ocean phytoplankton blooms and elevated global sea surface temperature baselines.`;
      }
      return `${MONTH_NAMES[m - 1]} ${yr} NASA EOSDIS Observation: Real-time MODIS Terra/Aqua and GHRSST MUR L4 composites capture contemporary planetary cryosphere, ocean chlorophyll, SST, and vegetation state.`;
    }

    if (m === 9) {
      return 'September 2007 Landmark Minimum: Arctic sea ice extent collapsed to 4.14 million km², shattering prior satellite records and exposing open polar ocean across the Beaufort and East Siberian seas.';
    }
    if (m >= 10) {
      return 'Late 2007 La Niña Phase: Strong equatorial Pacific upwelling cooled ENSO Region 3.4 sea surface temperatures while Arctic autumn freeze-up lagged behind historical climatology.';
    }
    if (m === 3) {
      return 'March 2007 Cryosphere Maximum: Annual winter Arctic ice peak (~14.7 million km²) prior to the onset of rapid spring-summer albedo feedback.';
    }
    return '2007 Historic Orbital Baseline: MODIS Terra/Aqua and GHRSST MUR sensors capture cryosphere extent, mid-latitude ocean boundary currents, and tropical thermal bands.';
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#060B14] text-[#F1F5F9]">
      <div
        id="aria-announcer"
        ref={ariaLiveElRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

      {/* TOP TELEMETRY RIBBON */}
      <header
        role="banner"
        className="border-b border-[#1A2E44] bg-[#0B1320] px-4 py-2.5 flex flex-wrap items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3 min-w-0">
          <BrandLogo size={34} />
          <h1 className="text-base sm:text-lg font-bold tracking-tight whitespace-nowrap">
            <span className="bg-gradient-to-r from-[#38BDF8] via-[#2DD4BF] to-[#5EEAD4] bg-clip-text text-transparent">
              Binaural Earth
            </span>{' '}
            <span className="text-[#F1F5F9]">Atlas</span>
          </h1>
          <span className="hidden md:inline text-xs font-mono-tabular text-[#94A3B8] whitespace-nowrap">
            · 3D Orbital Acoustic Observatory
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs font-mono-tabular">
          <span className="text-[#94A3B8]">
            EPOCH <strong className="text-[#5EEAD4] font-semibold">{activeDateStr}</strong>
          </span>
          <span className="text-[#94A3B8]">
            HDG{' '}
            <strong className="text-[#F1F5F9] font-semibold">
              {String(Math.round(listenerAngle)).padStart(3, '0')}° {activeLayer.shortCardinal}
            </strong>
          </span>
          <span className="hidden sm:inline text-[#94A3B8]">{utcClock}</span>

          <button
            ref={guideButtonRef}
            type="button"
            onClick={() => setIsOnboardingOpen(true)}
            aria-haspopup="dialog"
            className="px-2.5 py-1.5 border border-[#1A2E44] bg-[#060B14] text-xs font-mono-tabular text-[#94A3B8] hover:text-[#F1F5F9] hover:border-[#5EEAD4] flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Guide</span>
          </button>

          <button
            type="button"
            onClick={handleToggleSpeech}
            aria-pressed={speechEnabled}
            className={`px-2.5 py-1.5 border text-xs font-mono-tabular flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              speechEnabled
                ? 'bg-[#111D30] border-[#5EEAD4] text-[#5EEAD4]'
                : 'bg-[#060B14] border-[#1A2E44] text-[#94A3B8] hover:text-[#F1F5F9] hover:border-[#5EEAD4]'
            }`}
          >
            <Speech className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Speech: {speechEnabled ? 'ON' : 'OFF'}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleTogglePlay()}
            aria-pressed={isPlaying}
            className={`px-3.5 py-1.5 border text-xs font-semibold uppercase tracking-wider flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              isPlaying
                ? 'bg-[#FB7185] border-[#FB7185] text-[#060B14] hover:bg-[#fda4af]'
                : 'bg-[#5EEAD4] border-[#5EEAD4] text-[#060B14] hover:bg-[#99f6e4]'
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Pause Audio</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Start Audio</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* MAIN OBSERVATORY STAGE: 65% VISUAL & CHRONOLOGY | 35% ACOUSTIC & TELEMETRY */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_minmax(360px,36%)]">
        {/* LEFT / CENTER STAGE */}
        <div className="p-4 flex flex-col gap-4 border-b lg:border-b-0 lg:border-r border-[#1A2E44]">
          <SatelliteMapCanvas
            sourceCanvas={activeCanvas}
            sstCanvas={sstCanvas}
            activeLayerKey={activeLayerKey}
            archiveYear={archiveYear}
            dateString={activeDateStr}
            frameRevision={frameRevision}
            dataSource={dataSource}
            isLoading={isLoading}
            projection={projection}
            showAnomalyHeatmap={showAnomalyHeatmap}
            onToggleProjection={setProjection}
            onToggleAnomalyHeatmap={handleToggleAnomalyHeatmap}
            onSelectBookmark={(key, label) => {
              handleSelectLayer(key);
              appendLog(`TARGET LOCKED: ${label.toUpperCase()}`, 'mint');
            }}
          />

          {/* CHRONOLOGY & ACOUSTIC DECK */}
          <section
            aria-label="Satellite Archive Chronology and Acoustic Controls"
            className="border border-[#1A2E44] bg-[#0B1320] p-4 flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#F1F5F9]">
                  NASA Satellite Archive Sequencer
                </h2>
                <span className="text-xs font-mono-tabular text-[#5EEAD4]">
                  {MONTH_NAMES[monthIndex - 1]} {archiveYear} · CADENCE {cadenceMs} MS
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Archive Year Switcher (2026 / 2025 / 2007) */}
                <div
                  className="flex border border-[#1A2E44] bg-[#060B14]"
                  role="group"
                  aria-label="Archive Year Selector"
                >
                  {ARCHIVE_YEARS.map((yr) => (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => void handleChangeYear(yr)}
                      aria-pressed={archiveYear === yr}
                      className={`px-2.5 py-1 text-xs font-mono-tabular cursor-pointer whitespace-nowrap ${
                        archiveYear === yr
                          ? 'bg-[#5EEAD4] text-[#060B14] font-semibold'
                          : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                      }`}
                    >
                      {yr}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => void handleTestSpatialAudio()}
                  disabled={isTestingSpatial}
                  className="px-3 py-1 border border-[#1A2E44] bg-[#060B14] text-[#F1F5F9] hover:border-[#5EEAD4] hover:text-[#5EEAD4] disabled:opacity-60 text-xs font-mono-tabular flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Radio className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isTestingSpatial ? 'Sweeping N→E→S→W' : 'Test Spatial Sweep'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_210px_210px] gap-3 items-center">
              {/* Timeline Scrubber */}
              <div className="border border-[#1A2E44] bg-[#060B14] p-2.5">
                <div className="flex items-center justify-between text-[11px] font-mono-tabular text-[#94A3B8] mb-1.5">
                  <label htmlFor="timelineSlider">
                    {archiveYear} TIMELINE (JAN – {archiveYear === 2026 ? 'NOV' : 'DEC'})
                  </label>
                  <span className="text-[#5EEAD4]">{activeDateStr}</span>
                </div>
                <input
                  id="timelineSlider"
                  type="range"
                  min={1}
                  max={maxMonth}
                  step={1}
                  value={monthIndex}
                  onChange={(e) => void handleScrubMonth(parseInt(e.target.value, 10))}
                  className="scientific-slider"
                  aria-label={`${archiveYear} satellite archive month scrubber`}
                />
              </div>

              {/* Master Volume */}
              <div className="border border-[#1A2E44] bg-[#060B14] p-2.5">
                <div className="flex items-center justify-between text-[11px] font-mono-tabular text-[#94A3B8] mb-1.5">
                  <label htmlFor="volumeSlider" className="flex items-center gap-1.5">
                    {masterVolume === 0 ? (
                      <VolumeX className="w-3.5 h-3.5 text-[#FB7185]" aria-hidden="true" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-[#5EEAD4]" aria-hidden="true" />
                    )}
                    <span>MASTER GAIN</span>
                  </label>
                  <span className="text-[#F1F5F9]">{Math.round(masterVolume * 100)}%</span>
                </div>
                <input
                  id="volumeSlider"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={masterVolume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  className="scientific-slider"
                  aria-label="Master audio gain"
                />
              </div>

              {/* Harmonic Scale Selector */}
              <div className="border border-[#1A2E44] bg-[#060B14] p-2.5">
                <div className="text-[11px] font-mono-tabular text-[#94A3B8] mb-1">
                  HARMONIC QUANTIZER
                </div>
                <div className="grid grid-cols-3 gap-1" role="group" aria-label="Harmonic Scale Mode">
                  {(['pentatonic', 'dorian', 'harmonic'] as ScaleMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => handleScaleModeChange(mode)}
                      aria-pressed={scaleMode === mode}
                      className={`py-1 text-[10px] font-mono-tabular uppercase border cursor-pointer ${
                        scaleMode === mode
                          ? 'bg-[#5EEAD4] border-[#5EEAD4] text-[#060B14] font-semibold'
                          : 'bg-[#0B1320] border-[#1A2E44] text-[#94A3B8] hover:text-[#F1F5F9]'
                      }`}
                    >
                      {mode === 'pentatonic' ? 'PENTA' : mode === 'dorian' ? 'DORIAN' : 'HARM'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Seasonal Benchmarks + Climate Context */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-1">
              <div
                className="grid grid-cols-5 gap-1.5 shrink-0"
                role="group"
                aria-label={`${archiveYear} Seasonal Benchmarks`}
              >
                {benchmarks.map((bm) => {
                  const isCurrent = monthIndex === bm.monthIndex;
                  const isSep = bm.monthIndex === 9;
                  return (
                    <button
                      key={bm.monthIndex}
                      type="button"
                      onClick={() => void handleScrubMonth(bm.monthIndex)}
                      title={bm.title}
                      aria-pressed={isCurrent}
                      className={`py-1.5 px-2.5 border text-[11px] font-mono-tabular font-semibold cursor-pointer ${
                        isCurrent
                          ? isSep
                            ? 'bg-[#FB7185] border-[#FB7185] text-[#060B14]'
                            : 'bg-[#5EEAD4] border-[#5EEAD4] text-[#060B14]'
                          : isSep
                          ? 'bg-[#111D30] border-[#FB7185] text-[#FB7185] hover:bg-[#192841]'
                          : 'bg-[#111D30] border-[#1A2E44] text-[#F1F5F9] hover:border-[#5EEAD4]'
                      }`}
                    >
                      {bm.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-[#94A3B8] leading-relaxed">
                {getMonthlyClimateBrief(archiveYear, monthIndex)}
              </p>
            </div>
          </section>

          {/* TABBED SCIENTIFIC CONSOLE */}
          <section
            aria-label="Observatory Reference Console"
            className="border border-[#1A2E44] bg-[#0B1320] flex flex-col"
          >
            <div className="flex items-center justify-between border-b border-[#1A2E44] bg-[#111D30] px-3">
              <div className="flex items-center" role="tablist" aria-label="Reference Panels">
                {(
                  [
                    ['log', 'Mission Telemetry Log'],
                    ['manual', 'Keyboard & Screen-Reader Manual'],
                    ['specs', 'Cardinal & GIBS Specifications'],
                  ] as Array<[ReferenceTab, string]>
                ).map(([tabKey, label]) => (
                  <button
                    key={tabKey}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tabKey}
                    onClick={() => setActiveTab(tabKey)}
                    className={`px-3 py-2 text-xs font-mono-tabular border-r border-[#1A2E44] cursor-pointer whitespace-nowrap ${
                      activeTab === tabKey
                        ? 'bg-[#060B14] text-[#5EEAD4] font-semibold'
                        : 'text-[#94A3B8] hover:text-[#F1F5F9]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-[11px] font-mono-tabular text-[#94A3B8] hidden sm:inline">
                REV #{String(frameRevision).padStart(3, '0')}
              </span>
            </div>

            <div className="p-3 bg-[#060B14]">
              {activeTab === 'log' && (
                <div className="terminal-window h-36 overflow-y-auto font-mono-tabular text-[11px] leading-relaxed">
                  {logs.map((entry) => (
                    <div key={entry.id} className="flex gap-2">
                      <span className="text-[#94A3B8] shrink-0">[{entry.timestamp}]</span>
                      <span
                        className={
                          entry.tone === 'coral'
                            ? 'text-[#FB7185]'
                            : entry.tone === 'mint'
                            ? 'text-[#5EEAD4]'
                            : entry.tone === 'warn'
                            ? 'text-[#F59E0B]'
                            : 'text-[#F1F5F9]'
                        }
                      >
                        {entry.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'manual' && (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  <div className="flex items-center justify-between border-b border-[#1A2E44] pb-1">
                    <dt className="font-mono-tabular text-[#5EEAD4]">
                      <kbd className="border border-[#1A2E44] bg-[#0B1320] px-1.5 py-0.5">
                        Space
                      </kbd>{' '}
                      /{' '}
                      <kbd className="border border-[#1A2E44] bg-[#0B1320] px-1.5 py-0.5">
                        Enter
                      </kbd>
                    </dt>
                    <dd>Toggle Audio & Sequencer</dd>
                  </div>
                  <div className="flex items-center justify-between border-b border-[#1A2E44] pb-1">
                    <dt className="font-mono-tabular text-[#5EEAD4]">
                      <kbd className="border border-[#1A2E44] bg-[#0B1320] px-1.5 py-0.5">←</kbd> /{' '}
                      <kbd className="border border-[#1A2E44] bg-[#0B1320] px-1.5 py-0.5">→</kbd>
                    </dt>
                    <dd>Rotate Head 90° (Shift = 15°)</dd>
                  </div>
                  <div className="flex items-center justify-between border-b border-[#1A2E44] pb-1">
                    <dt className="font-mono-tabular text-[#5EEAD4]">
                      <kbd className="border border-[#1A2E44] bg-[#0B1320] px-1.5 py-0.5">1</kbd>–
                      <kbd className="border border-[#1A2E44] bg-[#0B1320] px-1.5 py-0.5">4</kbd>
                    </dt>
                    <dd>Jump N / E / S / W Cardinal</dd>
                  </div>
                  <div className="flex items-center justify-between border-b border-[#1A2E44] pb-1">
                    <dt className="font-mono-tabular text-[#5EEAD4]">
                      <kbd className="border border-[#1A2E44] bg-[#0B1320] px-1.5 py-0.5">H</kbd> /{' '}
                      <kbd className="border border-[#1A2E44] bg-[#0B1320] px-1.5 py-0.5">M</kbd> /{' '}
                      <kbd className="border border-[#1A2E44] bg-[#0B1320] px-1.5 py-0.5">A</kbd>
                    </dt>
                    <dd>Status / Toggle Globe / Anomaly Heatmap</dd>
                  </div>
                </dl>
              )}

              {activeTab === 'specs' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse font-mono-tabular text-[11px]">
                    <thead>
                      <tr className="border-b border-[#1A2E44] text-[#94A3B8]">
                        <th className="py-1 pr-3">HEADING</th>
                        <th className="py-1 pr-3">PHENOMENON</th>
                        <th className="py-1 pr-3">NASA GIBS LAYER</th>
                        <th className="py-1 pr-3">WAVE</th>
                        <th className="py-1">3D COORDS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {LAYER_ORDER.map((key) => {
                        const m = NASA_GIBS_LAYERS[key];
                        return (
                          <tr
                            key={key}
                            className={`border-b border-[#1A2E44]/60 ${
                              key === activeLayerKey ? 'text-[#5EEAD4]' : 'text-[#F1F5F9]'
                            }`}
                          >
                            <td className="py-1.5 pr-3">
                              {m.azimuthLabel} {m.cardinal}
                            </td>
                            <td className="py-1.5 pr-3">{m.phenomenon}</td>
                            <td className="py-1.5 pr-3">{m.gibsLayerId}</td>
                            <td className="py-1.5 pr-3 uppercase">{m.waveform}</td>
                            <td className="py-1.5">
                              ({m.position.x},{m.position.y},{m.position.z})
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN: ACOUSTIC TELEMETRY, COMPASS HUD, 6-SIGNAL MATRIX & TEMPORAL CHART */}
        <aside
          aria-label="Binaural Acoustics and 6-Signal Telemetry"
          className="p-4 flex flex-col gap-4 bg-[#0B1320]"
        >
          <AudioSpectrumBar
            analyser={audioEngineRef.current?.getAnalyserNode() ?? null}
            isPlaying={isPlaying}
            isTestingSpatial={isTestingSpatial}
          />

          <RadarCompassHud
            listenerAngle={listenerAngle}
            activeLayerKey={activeLayerKey}
            vectors={vectors}
            onChangeHeading={(deg) => handleSetHeading(deg)}
            onSelectLayer={handleSelectLayer}
          />

          <section
            aria-label="6-Signal Feature Vector Matrix"
            className="border border-[#1A2E44] bg-[#0B1320] flex flex-col"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#1A2E44] bg-[#111D30]">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#F1F5F9]">
                6-Signal Acoustic Vector
              </h2>
              <span className="text-[11px] font-mono-tabular text-[#5EEAD4]">
                {activeLayer.cardinal.toUpperCase()} · {activePitchHz.toFixed(0)} HZ
              </span>
            </div>

            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 bg-[#060B14]">
              {signalRows.map((row) => {
                const pct = Math.round(row.value * 100);
                return (
                  <div key={row.label} className="border border-[#1A2E44] bg-[#0B1320] p-2">
                    <div className="flex items-center justify-between text-xs font-mono-tabular">
                      <span className="text-[#F1F5F9]">{row.label}</span>
                      <span className={row.isCoral ? 'text-[#FB7185] font-semibold' : 'text-[#5EEAD4] font-semibold'}>
                        {row.value.toFixed(3)}
                      </span>
                    </div>
                    <div
                      className="mt-1.5 h-1.5 w-full bg-[#060B14] border border-[#1A2E44]"
                      role="progressbar"
                      aria-label={row.label}
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className={row.isCoral ? 'h-full bg-[#FB7185]' : 'h-full bg-[#5EEAD4]'}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-1 text-[10px] font-mono-tabular text-[#94A3B8]">
                      {row.target}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <TemporalTrendsChart
            history={history}
            archiveYear={archiveYear}
            maxMonths={maxMonth}
          />
        </aside>
      </main>

      <footer
        role="contentinfo"
        className="border-t border-[#1A2E44] bg-[#0B1320] px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono-tabular text-[#94A3B8]"
      >
        <span>ORTHOGRAPHIC 3D + EPSG:4326 · WEB AUDIO HRTF BINAURAL ENGINE</span>
        <span>LIVE NASA GIBS 2025–2026 & 2007 ARCHIVE · WCAG AAA KEYBOARD ACCESSIBLE</span>
      </footer>

      <OnboardingOverlay
        isOpen={isOnboardingOpen}
        listenerAngle={listenerAngle}
        activeLayerKey={activeLayerKey}
        vectors={vectors}
        frequencies={frequencies}
        archiveYear={archiveYear}
        monthIndex={monthIndex}
        scaleMode={scaleMode}
        projection={projection}
        showAnomalyHeatmap={showAnomalyHeatmap}
        speechEnabled={speechEnabled}
        isPlaying={isPlaying}
        isTestingSpatial={isTestingSpatial}
        onClose={handleCloseOnboarding}
        onSelectLayer={handleSelectLayer}
        onRotateStep={(deltaDeg) => handleSetHeading(listenerAngle + deltaDeg)}
        onTestSpatialAudio={() => void handleTestSpatialAudio()}
        onScaleModeChange={handleScaleModeChange}
        onChangeYear={(yr) => void handleChangeYear(yr)}
        onScrubMonth={(m) => void handleScrubMonth(m)}
        onToggleProjection={setProjection}
        onToggleAnomalyHeatmap={handleToggleAnomalyHeatmap}
        onToggleSpeech={handleToggleSpeech}
        onAnnounceStep={handleAnnounceOnboardingStep}
      />
    </div>
  );
}
