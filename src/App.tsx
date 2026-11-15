import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HelpCircle, Moon, Pause, Play, Radio, Speech, Volume2, VolumeX, Wind } from 'lucide-react';
import { extractFeatureVector, resetFeatureVectorCache } from './analysis/featureVector';
import {
  ANALYSIS_HEIGHT,
  ANALYSIS_WIDTH,
  loadGIBSFrame,
  renderProceduralFrame,
} from './analysis/pixelScanner';
import {
  buildWindVectorField,
  sampleWindAlongHeading,
  WindVectorField,
} from './analysis/windVectorField';
import { AudioEngine, EnvironmentReverbMode, SpatialPanningMode } from './audio/audioEngine';
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
  AudioEventEntry,
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

type ReferenceTab = 'log' | 'audio-events' | 'manual' | 'specs';

function createOffscreenCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = ANALYSIS_WIDTH;
  c.height = ANALYSIS_HEIGHT;
  return c;
}

function getUtcClockString(ms = Date.now()): string {
  return new Date(ms).toISOString().slice(11, 19) + ' UTC';
}

const ONBOARDING_STORAGE_KEY = 'bea_onboarding_completed_v1';
const NIGHT_MODE_STORAGE_KEY = 'bea_observatory_night_mode_v1';

function hasCompletedOnboarding(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function getInitialNightMode(): boolean {
  try {
    return window.localStorage.getItem(NIGHT_MODE_STORAGE_KEY) === '1';
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

  const [utcTimestampMs, setUtcTimestampMs] = useState<number>(() => Date.now());
  const utcClock = getUtcClockString(utcTimestampMs);
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
  const [reverbMode, setReverbMode] = useState<EnvironmentReverbMode>('vacuum');
  const [panningMode, setPanningMode] = useState<SpatialPanningMode>('smooth360');
  const [atmosphericFlowEnabled, setAtmosphericFlowEnabled] = useState<boolean>(true);
  const [windField, setWindField] = useState<WindVectorField | null>(null);
  const [projection, setProjection] = useState<ProjectionMode>('globe');
  const [showAnomalyHeatmap, setShowAnomalyHeatmap] = useState<boolean>(false);
  const [showSolarTerminator, setShowSolarTerminator] = useState<boolean>(true);
  const [observatoryNightMode, setObservatoryNightMode] = useState<boolean>(() =>
    getInitialNightMode()
  );
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
  const [audioEvents, setAudioEvents] = useState<AudioEventEntry[]>([]);
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
    const engine = new AudioEngine();
    engine.setAudioEventListener((evt) => {
      setAudioEvents((prev) => {
        const duplicateLatest = prev.some(
          (item) =>
            item.dateStr === evt.dateStr &&
            item.layerKey === evt.layerKey &&
            item.kind === evt.kind &&
            Math.abs(item.value - evt.value) < 0.001
        );
        if (duplicateLatest) return prev;
        return [evt, ...prev].slice(0, 60);
      });
    });
    audioEngineRef.current = engine;
    announcerRef.current = new AccessibilityAnnouncer();
    announcerRef.current.attachElement(ariaLiveElRef.current);

    const clockInterval = window.setInterval(() => {
      setUtcTimestampMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(clockInterval);
      if (sequencerTimerRef.current !== null) {
        window.clearTimeout(sequencerTimerRef.current);
      }
      engine.setAudioEventListener(null);
      engine.dispose();
      announcerRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    activeLayerRef.current = activeLayerKey;
  }, [activeLayerKey]);

  useEffect(() => {
    document.documentElement.classList.toggle('observatory-night', observatoryNightMode);
    try {
      window.localStorage.setItem(NIGHT_MODE_STORAGE_KEY, observatoryNightMode ? '1' : '0');
    } catch {
      // Ignore storage restrictions
    }
  }, [observatoryNightMode]);

  const recomputeFrequencies = useCallback(
    (
      vecs: Record<LayerKey, FeatureVector>,
      mode: ScaleMode,
      targetCadenceMs: number
    ): Record<LayerKey, number> => {
      const applyDoppler = (key: LayerKey) => {
        const base = quantizeToPentatonic(vecs[key].hue, vecs[key].brightness, mode).frequency;
        const { multiplier } = AudioEngine.computeDopplerShift(vecs[key].motion, targetCadenceMs);
        return base * multiplier;
      };
      return {
        north: applyDoppler('north'),
        east: applyDoppler('east'),
        south: applyDoppler('south'),
        west: applyDoppler('west'),
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

        const nextFreqs = recomputeFrequencies(nextVectors, scaleMode, nextCadence);
        setFrequencies(nextFreqs);

        if (updateAudio && audioEngineRef.current?.isRunning()) {
          audioEngineRef.current.updateAllLayers(nextVectors, nextCadence, dateStr);
        } else {
          audioEngineRef.current?.evaluateArchiveEvents(nextVectors, nextCadence, dateStr);
        }

        const nextWindField = await buildWindVectorField(dateStr, canvases.south, canvases.east);
        setWindField(nextWindField);
        audioEngineRef.current?.updateWindField(nextWindField);

        const intensity = Number(
          ((currentLayerVec.brightness + currentLayerVec.saturation) / 2).toFixed(3)
        );
        const anomaly = Number(currentLayerVec.climateAnomaly.toFixed(3));
        const dopplerShift = AudioEngine.computeDopplerShift(currentLayerVec.motion, nextCadence);
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
            `${dateStr} BENCHMARK · ARCTIC SUMMER MINIMUM · ANOMALY ${(anomaly * 100).toFixed(
              1
            )}% · DOPPLER +${dopplerShift.shiftPct.toFixed(1)}%`,
            'coral'
          );
        } else {
          appendLog(
            `INGESTED ${dateStr} · ${primarySource.toUpperCase()} · CADENCE ${nextCadence}MS · DOPPLER +${dopplerShift.shiftPct.toFixed(
              1
            )}%`,
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
      const normalizedRaw = ((Math.round(rawAngleDeg) % 360) + 360) % 360;
      const effectiveAngle =
        panningMode === 'cardinal'
          ? ((Math.round(normalizedRaw / 90) * 90) % 360 + 360) % 360
          : normalizedRaw;
      const nearestKey = azimuthToLayerKey(effectiveAngle);
      const meta = NASA_GIBS_LAYERS[nearestKey];

      setListenerAngle(effectiveAngle);
      setActiveLayerKey(nearestKey);
      activeLayerRef.current = nearestKey;
      audioEngineRef.current?.setHeading(effectiveAngle);

      const vec = vectors[nearestKey];
      if (vec) {
        const nextCadence = Math.round(2500 - vec.motion * 1000);
        setCadenceMs(nextCadence);
        setFrequencies(recomputeFrequencies(vectors, scaleMode, nextCadence));
      }

      setFrameRevision((r) => r + 1);
      appendLog(
        `HEADING ${String(effectiveAngle).padStart(3, '0')}° · ${
          panningMode === 'smooth360' ? '360° SMOOTH HRTF' : 'CARDINAL SNAP'
        } · FOCUS ${meta.cardinal.toUpperCase()} (${meta.domain.toUpperCase()})`,
        'mint'
      );
      announcerRef.current?.announce(
        customAnnouncement ??
          `Facing ${effectiveAngle} degrees, nearest cardinal ${meta.cardinal}. Active observation: ${meta.phenomenon}.`
      );
    },
    [appendLog, panningMode, recomputeFrequencies, scaleMode, vectors]
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
      audioEngineRef.current?.resetArchiveEventHistory();
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
    const nextFreqs = recomputeFrequencies(vectors, mode, cadenceMs);
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

  const handleToggleSolarTerminator = useCallback(() => {
    setShowSolarTerminator((prev) => {
      const next = !prev;
      appendLog(
        `SOLAR TERMINATORS OVERLAY ${next ? 'ENABLED' : 'DISABLED'} · ${getUtcClockString()}`,
        next ? 'mint' : 'info'
      );
      announcerRef.current?.announceImmediate(
        `Solar Terminators shadow overlay ${next ? 'enabled' : 'disabled'}.`
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

  const handleReverbModeChange = useCallback(
    (mode: EnvironmentReverbMode) => {
      setReverbMode(mode);
      audioEngineRef.current?.setEnvironmentReverb(mode);
      const label =
        mode === 'vacuum' ? 'Vacuum / Deep Space (Dry)' : 'Planetary Atmospheric (Wet Convolution)';
      appendLog(`ENVIRONMENT REVERB -> ${label.toUpperCase()}`, 'mint');
      announcerRef.current?.announce(`Environment reverb set to ${label}.`);
    },
    [appendLog]
  );

  const handleToggleReverb = useCallback(() => {
    setReverbMode((prev) => {
      const next: EnvironmentReverbMode = prev === 'vacuum' ? 'atmospheric' : 'vacuum';
      audioEngineRef.current?.setEnvironmentReverb(next);
      const label =
        next === 'vacuum' ? 'Vacuum / Deep Space (Dry)' : 'Planetary Atmospheric (Wet Convolution)';
      appendLog(`ENVIRONMENT REVERB -> ${label.toUpperCase()}`, 'mint');
      announcerRef.current?.announce(`Environment reverb set to ${label}.`);
      return next;
    });
  }, [appendLog]);

  const handleToggleNightMode = useCallback(() => {
    setObservatoryNightMode((prev) => {
      const next = !prev;
      appendLog(
        next
          ? 'OBSERVATORY NIGHT MODE ENABLED · DEEP RED DARK-ADAPTATION PALETTE & REDUCED CANVAS BLOOM'
          : 'OBSERVATORY NIGHT MODE DISABLED · STANDARD OBSIDIAN SPECTRUM RESTORED',
        next ? 'coral' : 'info'
      );
      announcerRef.current?.announceImmediate(
        next
          ? 'Observatory night mode enabled. Deep red dark adaptation palette active and canvas bloom reduced.'
          : 'Observatory night mode disabled. Standard spectrum restored.'
      );
      return next;
    });
  }, [appendLog]);

  const handlePanningModeChange = useCallback(
    (mode: SpatialPanningMode) => {
      setPanningMode(mode);
      audioEngineRef.current?.setPanningMode(mode);
      if (mode === 'cardinal') {
        const snapped = ((Math.round(listenerAngle / 90) * 90) % 360 + 360) % 360;
        const nearestKey = azimuthToLayerKey(snapped);
        setListenerAngle(snapped);
        setActiveLayerKey(nearestKey);
        activeLayerRef.current = nearestKey;
      }
      const label =
        mode === 'smooth360'
          ? 'Full 360° Smooth HRTF Panning'
          : 'Cardinal Layer Snap (90° Crossfade)';
      appendLog(`SPATIAL PANNING MODE -> ${label.toUpperCase()}`, 'mint');
      announcerRef.current?.announceImmediate(`Spatial panning mode set to ${label}.`);
    },
    [appendLog, listenerAngle]
  );

  const handleTogglePanningMode = useCallback(() => {
    handlePanningModeChange(panningMode === 'smooth360' ? 'cardinal' : 'smooth360');
  }, [handlePanningModeChange, panningMode]);

  const handleToggleAtmosphericFlow = useCallback(() => {
    setAtmosphericFlowEnabled((prev) => {
      const next = !prev;
      audioEngineRef.current?.setAtmosphericFlowEnabled(next);
      appendLog(
        `ATMOSPHERIC FLOW (GRANULAR WIND) ${next ? 'ENABLED' : 'MUTED'}`,
        next ? 'mint' : 'info'
      );
      announcerRef.current?.announceImmediate(
        `Atmospheric flow granular wind noise-floor ${next ? 'enabled' : 'muted'}.`
      );
      return next;
    });
  }, [appendLog]);

  const handleAnnounceOnboardingStep = useCallback((msg: string) => {
    announcerRef.current?.announceImmediate(msg);
  }, []);

  useKeyboardControls({
    disabled: isOnboardingOpen,
    panningMode,
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
    onToggleSolarTerminator: handleToggleSolarTerminator,
    onToggleReverb: handleToggleReverb,
    onTogglePanningMode: handleTogglePanningMode,
    onToggleAtmosphericFlow: handleToggleAtmosphericFlow,
    onToggleNightMode: handleToggleNightMode,
  });

  const activeLayer = NASA_GIBS_LAYERS[activeLayerKey];
  const activeVector = vectors[activeLayerKey];
  const headingWind = useMemo(
    () => (windField ? sampleWindAlongHeading(windField, listenerAngle) : null),
    [windField, listenerAngle]
  );
  const activeDateStr = formatArchiveDate(archiveYear, monthIndex);
  const maxMonth = getMaxMonthForYear(archiveYear);
  const benchmarks = getSeasonalBenchmarks(archiveYear);
  const activeCanvas = offscreenMapRef.current?.[activeLayerKey] ?? null;
  const sstCanvas = offscreenMapRef.current?.south ?? null;
  const activeDoppler = AudioEngine.computeDopplerShift(activeVector.motion, cadenceMs);
  const activePitchHz = frequencies[activeLayerKey] ?? 220;
  const activeFilterHz = Math.round(400 + activeVector.saturation * 5600);
  const activeNoteDegree = Math.floor(activeVector.hue * 9.99) + 1;

  const signalRows = [
    {
      label: 'Brightness',
      value: activeVector.brightness,
      target: `${activePitchHz.toFixed(0)} Hz (${activeDoppler.multiplier.toFixed(3)}×)`,
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
      target: `${cadenceMs} ms · Doppler +${activeDoppler.shiftPct.toFixed(1)}%`,
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
    <div className="min-h-screen flex flex-col bg-[var(--bg-obsidian)] text-[var(--text-primary)]">
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
        className="border-b border-[var(--border-grid)] bg-[var(--bg-console)] px-4 py-2.5 flex flex-wrap items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3 min-w-0">
          <BrandLogo size={34} nightMode={observatoryNightMode} />
          <h1 className="text-base sm:text-lg font-bold tracking-tight whitespace-nowrap">
            <span
              className={`bg-gradient-to-r bg-clip-text text-transparent ${
                observatoryNightMode
                  ? 'from-[#B91C1C] via-[#DC2626] to-[#FF3B30]'
                  : 'from-[#38BDF8] via-[#2DD4BF] to-[#5EEAD4]'
              }`}
            >
              Binaural Earth
            </span>{' '}
            <span className="text-[var(--text-primary)]">Atlas</span>
          </h1>
          <span className="hidden md:inline text-xs font-mono-tabular text-[var(--text-muted)] whitespace-nowrap">
            · 3D Orbital Acoustic Observatory
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs font-mono-tabular">
          <span className="text-[var(--text-muted)]">
            EPOCH <strong className="text-[var(--accent-mint)] font-semibold">{activeDateStr}</strong>
          </span>
          <span className="text-[var(--text-muted)]">
            HDG{' '}
            <strong className="text-[var(--text-primary)] font-semibold">
              {String(Math.round(listenerAngle)).padStart(3, '0')}° {activeLayer.shortCardinal}
            </strong>
          </span>
          <span className="hidden sm:inline text-[var(--text-muted)]">{utcClock}</span>

          <button
            ref={guideButtonRef}
            type="button"
            onClick={() => setIsOnboardingOpen(true)}
            aria-haspopup="dialog"
            className="px-2.5 py-1.5 border border-[var(--border-grid)] bg-[var(--bg-obsidian)] text-xs font-mono-tabular text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent-mint)] flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
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
                ? 'bg-[var(--bg-panel)] border-[var(--accent-mint)] text-[var(--accent-mint)]'
                : 'bg-[var(--bg-obsidian)] border-[var(--border-grid)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent-mint)]'
            }`}
          >
            <Speech className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Speech: {speechEnabled ? 'ON' : 'OFF'}</span>
          </button>

          <button
            type="button"
            onClick={handleToggleNightMode}
            aria-pressed={observatoryNightMode}
            title="Observatory Night Mode (N) — High-contrast deep red palette & reduced canvas bloom"
            className={`px-2.5 py-1.5 border text-xs font-mono-tabular flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              observatoryNightMode
                ? 'bg-[var(--bg-panel)] border-[var(--accent-mint)] text-[var(--accent-mint)] font-semibold'
                : 'bg-[var(--bg-obsidian)] border-[var(--border-grid)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent-mint)]'
            }`}
          >
            <Moon className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Night Mode: {observatoryNightMode ? 'ON' : 'OFF'}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleTogglePlay()}
            aria-pressed={isPlaying}
            className={`px-3.5 py-1.5 border text-xs font-semibold uppercase tracking-wider flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              isPlaying
                ? 'bg-[var(--accent-coral)] border-[var(--accent-coral)] text-[var(--bg-obsidian)] hover:opacity-90'
                : 'bg-[var(--accent-mint)] border-[var(--accent-mint)] text-[var(--bg-obsidian)] hover:opacity-90'
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
        <div className="p-4 flex flex-col gap-4 border-b lg:border-b-0 lg:border-r border-[var(--border-grid)]">
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
            showSolarTerminator={showSolarTerminator}
            utcTimestampMs={utcTimestampMs}
            windField={windField}
            nightMode={observatoryNightMode}
            onToggleProjection={setProjection}
            onToggleAnomalyHeatmap={handleToggleAnomalyHeatmap}
            onToggleSolarTerminator={handleToggleSolarTerminator}
            onSelectBookmark={(key, label) => {
              handleSelectLayer(key);
              appendLog(`TARGET LOCKED: ${label.toUpperCase()}`, 'mint');
            }}
          />

          {/* CHRONOLOGY & ACOUSTIC DECK */}
          <section
            aria-label="Satellite Archive Chronology and Acoustic Controls"
            className="border border-[var(--border-grid)] bg-[var(--bg-console)] p-4 flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                  NASA Satellite Archive Sequencer &amp; Settings
                </h2>
                <span className="text-xs font-mono-tabular text-[var(--accent-mint)]">
                  {MONTH_NAMES[monthIndex - 1]} {archiveYear} · CADENCE {cadenceMs} MS
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Archive Year Switcher (2026 / 2025 / 2007) */}
                <div
                  className="flex border border-[var(--border-grid)] bg-[var(--bg-obsidian)]"
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
                          ? 'bg-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {yr}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleToggleNightMode}
                  aria-pressed={observatoryNightMode}
                  title="Observatory Night Mode (N) — Deep red dark-adaptation palette & reduced canvas bloom"
                  className={`px-2.5 py-1 border text-xs font-mono-tabular flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    observatoryNightMode
                      ? 'bg-[var(--accent-mint)] border-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                      : 'bg-[var(--bg-obsidian)] border-[var(--border-grid)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent-mint)]'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Observatory Night Mode</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleTestSpatialAudio()}
                  disabled={isTestingSpatial}
                  className="px-3 py-1 border border-[var(--border-grid)] bg-[var(--bg-obsidian)] text-[var(--text-primary)] hover:border-[var(--accent-mint)] hover:text-[var(--accent-mint)] disabled:opacity-60 text-xs font-mono-tabular flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Radio className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isTestingSpatial ? 'Sweeping N→E→S→W' : 'Test Spatial Sweep'}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {/* Row 1: Timeline & Master Gain */}
              <div className="grid grid-cols-1 md:grid-cols-[1fr_210px] gap-3 items-stretch">
                {/* Timeline Scrubber */}
                <div className="border border-[var(--border-grid)] bg-[var(--bg-obsidian)] p-2.5">
                  <div className="flex items-center justify-between text-[11px] font-mono-tabular text-[var(--text-muted)] mb-1.5">
                    <label htmlFor="timelineSlider">
                      {archiveYear} TIMELINE (JAN – {archiveYear === 2026 ? 'NOV' : 'DEC'})
                    </label>
                    <span className="text-[var(--accent-mint)]">{activeDateStr}</span>
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
                <div className="border border-[var(--border-grid)] bg-[var(--bg-obsidian)] p-2.5">
                  <div className="flex items-center justify-between text-[11px] font-mono-tabular text-[var(--text-muted)] mb-1.5">
                    <label htmlFor="volumeSlider" className="flex items-center gap-1.5">
                      {masterVolume === 0 ? (
                        <VolumeX className="w-3.5 h-3.5 text-[var(--accent-coral)]" aria-hidden="true" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5 text-[var(--accent-mint)]" aria-hidden="true" />
                      )}
                      <span>MASTER GAIN</span>
                    </label>
                    <span className="text-[var(--text-primary)]">{Math.round(masterVolume * 100)}%</span>
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
              </div>

              {/* Row 2: Harmonic Quantizer, Environment Reverb, Atmospheric Flow (Granular Wind) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-stretch">
                {/* Harmonic Scale Selector */}
                <div className="border border-[var(--border-grid)] bg-[var(--bg-obsidian)] p-2.5 flex flex-col justify-between">
                  <div className="text-[11px] font-mono-tabular text-[var(--text-muted)] mb-1.5">
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
                            ? 'bg-[var(--accent-mint)] border-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                            : 'bg-[var(--bg-console)] border-[var(--border-grid)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {mode === 'pentatonic' ? 'PENTA' : mode === 'dorian' ? 'DORIAN' : 'HARM'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Environment Reverb Selector */}
                <div className="border border-[var(--border-grid)] bg-[var(--bg-obsidian)] p-2.5 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-[11px] font-mono-tabular text-[var(--text-muted)] mb-1.5">
                    <span>ENVIRONMENT REVERB</span>
                    <span className="text-[var(--accent-mint)]">
                      {reverbMode === 'vacuum' ? 'DRY' : 'WET IR'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1" role="group" aria-label="Environment Reverb">
                    <button
                      type="button"
                      onClick={() => handleReverbModeChange('vacuum')}
                      aria-pressed={reverbMode === 'vacuum'}
                      title="Dry spatial signal with zero reverberation"
                      className={`py-1 px-1.5 text-[10px] font-mono-tabular uppercase border cursor-pointer whitespace-nowrap truncate ${
                        reverbMode === 'vacuum'
                          ? 'bg-[var(--accent-mint)] border-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                          : 'bg-[var(--bg-console)] border-[var(--border-grid)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      Vacuum / Space
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReverbModeChange('atmospheric')}
                      aria-pressed={reverbMode === 'atmospheric'}
                      title="2.8s stereo planetary atmospheric convolution reverb"
                      className={`py-1 px-1.5 text-[10px] font-mono-tabular uppercase border cursor-pointer whitespace-nowrap truncate ${
                        reverbMode === 'atmospheric'
                          ? 'bg-[var(--accent-mint)] border-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                          : 'bg-[var(--bg-console)] border-[var(--border-grid)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      Atmospheric
                    </button>
                  </div>
                </div>

                {/* Atmospheric Flow Granular Wind Layer */}
                <div className="border border-[var(--border-grid)] bg-[var(--bg-obsidian)] p-2.5 flex flex-col justify-between gap-1.5">
                  <div className="flex items-center justify-between text-[11px] font-mono-tabular">
                    <span className="text-[var(--text-muted)] flex items-center gap-1.5">
                      <Wind className="w-3.5 h-3.5 text-[var(--accent-mint)]" aria-hidden="true" />
                      <span>ATMOS FLOW</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleToggleAtmosphericFlow}
                      aria-pressed={atmosphericFlowEnabled}
                      title="Toggle Atmospheric Flow granular wind noise-floor (Shortcut: W)"
                      className={`px-2 py-0.5 text-[10px] font-mono-tabular uppercase border cursor-pointer whitespace-nowrap ${
                        atmosphericFlowEnabled
                          ? 'bg-[var(--accent-mint)] border-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                          : 'bg-[var(--bg-console)] border-[var(--border-grid)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {atmosphericFlowEnabled ? 'ON' : 'MUTED'}
                    </button>
                  </div>

                  <div className="h-1.5 w-full bg-[var(--bg-console)] border border-[var(--border-grid)]">
                    <div
                      className={
                        headingWind?.isHighWindOcean
                          ? 'h-full bg-[var(--accent-amber)]'
                          : 'h-full bg-[var(--accent-mint)]'
                      }
                      style={{
                        width: `${
                          atmosphericFlowEnabled && headingWind
                            ? Math.round(headingWind.intensity * 100)
                            : 0
                        }%`,
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] font-mono-tabular text-[var(--text-muted)] gap-2">
                    <span className="truncate">
                      {headingWind ? headingWind.zoneLabel : 'SYNCING WIND...'}
                    </span>
                    <span
                      className={`shrink-0 font-semibold ${
                        headingWind?.isHighWindOcean
                          ? 'text-[var(--accent-amber)]'
                          : 'text-[var(--accent-mint)]'
                      }`}
                    >
                      {headingWind ? `${headingWind.speedMs.toFixed(1)} m/s` : '-- m/s'}
                    </span>
                  </div>
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
                            ? 'bg-[var(--accent-coral)] border-[var(--accent-coral)] text-[var(--bg-obsidian)]'
                            : 'bg-[var(--accent-mint)] border-[var(--accent-mint)] text-[var(--bg-obsidian)]'
                          : isSep
                          ? 'bg-[var(--bg-panel)] border-[var(--accent-coral)] text-[var(--accent-coral)] hover:opacity-85'
                          : 'bg-[var(--bg-panel)] border-[var(--border-grid)] text-[var(--text-primary)] hover:border-[var(--accent-mint)]'
                      }`}
                    >
                      {bm.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                {getMonthlyClimateBrief(archiveYear, monthIndex)}
              </p>
            </div>
          </section>

          {/* TABBED SCIENTIFIC CONSOLE */}
          <section
            aria-label="Observatory Reference Console"
            className="border border-[var(--border-grid)] bg-[var(--bg-console)] flex flex-col"
          >
            <div className="flex flex-wrap items-center justify-between border-b border-[var(--border-grid)] bg-[var(--bg-panel)] px-3">
              <div className="flex flex-wrap items-center" role="tablist" aria-label="Reference Panels">
                {(
                  [
                    ['log', 'Mission Telemetry Log'],
                    [
                      'audio-events',
                      audioEvents.length > 0
                        ? `Audio Events (${audioEvents.length})`
                        : 'Audio Events',
                    ],
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
                    className={`px-3 py-2 text-xs font-mono-tabular border-r border-[var(--border-grid)] cursor-pointer whitespace-nowrap ${
                      activeTab === tabKey
                        ? tabKey === 'audio-events'
                          ? 'bg-[var(--bg-obsidian)] text-[var(--accent-coral)] font-semibold'
                          : 'bg-[var(--bg-obsidian)] text-[var(--accent-mint)] font-semibold'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 py-1">
                {activeTab === 'audio-events' && audioEvents.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAudioEvents([])}
                    className="text-[11px] font-mono-tabular text-[var(--text-muted)] hover:text-[var(--accent-coral)] cursor-pointer whitespace-nowrap"
                  >
                    Clear Events
                  </button>
                )}
                <span className="text-[11px] font-mono-tabular text-[var(--text-muted)] hidden sm:inline">
                  REV #{String(frameRevision).padStart(3, '0')}
                </span>
              </div>
            </div>

            <div className="p-3 bg-[var(--bg-obsidian)]">
              {activeTab === 'log' && (
                <div className="terminal-window h-36 overflow-y-auto font-mono-tabular text-[11px] leading-relaxed">
                  {logs.map((entry) => (
                    <div key={entry.id} className="flex gap-2">
                      <span className="text-[var(--text-muted)] shrink-0">[{entry.timestamp}]</span>
                      <span
                        className={
                          entry.tone === 'coral'
                            ? 'text-[var(--accent-coral)]'
                            : entry.tone === 'mint'
                            ? 'text-[var(--accent-mint)]'
                            : entry.tone === 'warn'
                            ? 'text-[var(--accent-amber)]'
                            : 'text-[var(--text-primary)]'
                        }
                      >
                        {entry.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'audio-events' && (
                <div className="terminal-window h-36 overflow-y-auto font-mono-tabular text-[11px] leading-relaxed">
                  {audioEvents.length === 0 ? (
                    <div className="h-full flex flex-col items-start justify-center gap-2 text-[var(--text-muted)]">
                      <span>
                        NO 2007 ARCHIVE AUDIO EVENTS DETECTED YET · AUDIOENGINE MONITORS CLIMATE
                        ANOMALY SPIKES (&ge;{Math.round(AudioEngine.ANOMALY_SPIKE_THRESHOLD * 100)}%) &amp;
                        HIGH INTENSITY MOTION (&ge;{Math.round(AudioEngine.HIGH_MOTION_THRESHOLD * 100)}%) IN
                        2007.
                      </span>
                      {archiveYear !== 2007 && (
                        <button
                          type="button"
                          onClick={async () => {
                            await handleChangeYear(2007);
                            await handleScrubMonth(9);
                          }}
                          className="px-2.5 py-1 border border-[var(--accent-coral)] bg-[var(--bg-panel)] text-[var(--accent-coral)] hover:bg-[var(--accent-coral)] hover:text-[var(--bg-obsidian)] text-xs font-mono-tabular cursor-pointer whitespace-nowrap"
                        >
                          Load 2007 Archive (Sep Minimum)
                        </button>
                      )}
                    </div>
                  ) : (
                    audioEvents.map((evt) => (
                      <div key={evt.id} className="flex flex-wrap gap-x-2 border-b border-[var(--border-grid)]/40 py-0.5">
                        <span className="text-[var(--text-muted)] shrink-0">[{evt.timestamp}]</span>
                        <span className="text-[var(--text-primary)] shrink-0">{evt.dateStr}</span>
                        <span
                          className={
                            evt.kind === 'climate_anomaly_spike'
                              ? 'text-[var(--accent-coral)] font-semibold shrink-0'
                              : 'text-[var(--accent-mint)] font-semibold shrink-0'
                          }
                        >
                          {evt.kind === 'climate_anomaly_spike' ? 'ANOMALY SPIKE' : 'HIGH MOTION'}
                        </span>
                        <span className="text-[var(--text-primary)]">{evt.message}</span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === 'manual' && (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  <div className="flex items-center justify-between border-b border-[var(--border-grid)] pb-1">
                    <dt className="font-mono-tabular text-[var(--accent-mint)]">
                      <kbd className="border border-[var(--border-grid)] bg-[var(--bg-console)] px-1.5 py-0.5">
                        Space
                      </kbd>{' '}
                      /{' '}
                      <kbd className="border border-[var(--border-grid)] bg-[var(--bg-console)] px-1.5 py-0.5">
                        Enter
                      </kbd>
                    </dt>
                    <dd>Toggle Audio & Sequencer</dd>
                  </div>
                  <div className="flex items-center justify-between border-b border-[var(--border-grid)] pb-1">
                    <dt className="font-mono-tabular text-[var(--accent-mint)]">
                      <kbd className="border border-[var(--border-grid)] bg-[var(--bg-console)] px-1.5 py-0.5">←</kbd> /{' '}
                      <kbd className="border border-[var(--border-grid)] bg-[var(--bg-console)] px-1.5 py-0.5">→</kbd>
                    </dt>
                    <dd>
                      {panningMode === 'smooth360'
                        ? 'Smooth Rotate 15° (Shift = 5°)'
                        : 'Snap Head 90° (Shift = 15°)'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between border-b border-[var(--border-grid)] pb-1">
                    <dt className="font-mono-tabular text-[var(--accent-mint)]">
                      <kbd className="border border-[var(--border-grid)] bg-[var(--bg-console)] px-1.5 py-0.5">1</kbd>–
                      <kbd className="border border-[var(--border-grid)] bg-[var(--bg-console)] px-1.5 py-0.5">4</kbd>
                    </dt>
                    <dd>Jump N / E / S / W Cardinal</dd>
                  </div>
                  <div className="flex items-center justify-between border-b border-[var(--border-grid)] pb-1">
                    <dt className="font-mono-tabular text-[var(--accent-mint)]">
                      <kbd className="border border-[var(--border-grid)] bg-[var(--bg-console)] px-1.5 py-0.5">H</kbd> /{' '}
                      <kbd className="border border-[var(--border-grid)] bg-[var(--bg-console)] px-1.5 py-0.5">M</kbd> /{' '}
                      <kbd className="border border-[var(--border-grid)] bg-[var(--bg-console)] px-1.5 py-0.5">A</kbd> /{' '}
                      <kbd className="border border-[var(--border-grid)] bg-[var(--bg-console)] px-1.5 py-0.5">T</kbd> /{' '}
                      <kbd className="border border-[var(--border-grid)] bg-[var(--bg-console)] px-1.5 py-0.5">R</kbd> /{' '}
                      <kbd className="border border-[var(--border-grid)] bg-[var(--bg-console)] px-1.5 py-0.5">P</kbd> /{' '}
                      <kbd className="border border-[var(--border-grid)] bg-[var(--bg-console)] px-1.5 py-0.5">W</kbd> /{' '}
                      <kbd className="border border-[var(--border-grid)] bg-[var(--bg-console)] px-1.5 py-0.5">N</kbd>
                    </dt>
                    <dd>Status / Globe / Heatmap / Solar / Reverb / Pan / Wind / Night</dd>
                  </div>
                </dl>
              )}

              {activeTab === 'specs' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse font-mono-tabular text-[11px]">
                    <thead>
                      <tr className="border-b border-[var(--border-grid)] text-[var(--text-muted)]">
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
                            className={`border-b border-[var(--border-grid)]/60 ${
                              key === activeLayerKey ? 'text-[var(--accent-mint)]' : 'text-[var(--text-primary)]'
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
          className="p-4 flex flex-col gap-4 bg-[var(--bg-console)]"
        >
          <AudioSpectrumBar
            analyser={audioEngineRef.current?.getAnalyserNode() ?? null}
            isPlaying={isPlaying}
            isTestingSpatial={isTestingSpatial}
            nightMode={observatoryNightMode}
          />

          <RadarCompassHud
            listenerAngle={listenerAngle}
            activeLayerKey={activeLayerKey}
            vectors={vectors}
            panningMode={panningMode}
            windTelemetry={headingWind}
            atmosphericFlowEnabled={atmosphericFlowEnabled}
            nightMode={observatoryNightMode}
            onChangeHeading={(deg) => handleSetHeading(deg)}
            onSelectLayer={handleSelectLayer}
            onChangePanningMode={handlePanningModeChange}
          />

          <section
            aria-label="6-Signal Feature Vector Matrix"
            className="border border-[var(--border-grid)] bg-[var(--bg-console)] flex flex-col"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-grid)] bg-[var(--bg-panel)]">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                6-Signal Acoustic Vector
              </h2>
              <span className="text-[11px] font-mono-tabular text-[var(--accent-mint)]">
                {activeLayer.cardinal.toUpperCase()} · {activePitchHz.toFixed(0)} HZ
              </span>
            </div>

            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 bg-[var(--bg-obsidian)]">
              {signalRows.map((row) => {
                const pct = Math.round(row.value * 100);
                return (
                  <div key={row.label} className="border border-[var(--border-grid)] bg-[var(--bg-console)] p-2">
                    <div className="flex items-center justify-between text-xs font-mono-tabular">
                      <span className="text-[var(--text-primary)]">{row.label}</span>
                      <span className={row.isCoral ? 'text-[var(--accent-coral)] font-semibold' : 'text-[var(--accent-mint)] font-semibold'}>
                        {row.value.toFixed(3)}
                      </span>
                    </div>
                    <div
                      className="mt-1.5 h-1.5 w-full bg-[var(--bg-obsidian)] border border-[var(--border-grid)]"
                      role="progressbar"
                      aria-label={row.label}
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className={row.isCoral ? 'h-full bg-[var(--accent-coral)]' : 'h-full bg-[var(--accent-mint)]'}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-1 text-[10px] font-mono-tabular text-[var(--text-muted)]">
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
            nightMode={observatoryNightMode}
          />
        </aside>
      </main>

      <footer
        role="contentinfo"
        className="border-t border-[var(--border-grid)] bg-[var(--bg-console)] px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono-tabular text-[var(--text-muted)]"
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
        nightMode={observatoryNightMode}
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
