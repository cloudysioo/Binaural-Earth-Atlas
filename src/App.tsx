import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  HelpCircle,
  Minus,
  Moon,
  Palette,
  Pause,
  Play,
  Radio,
  ScatterChart,
  Sparkles,
  Speech,
  Volume2,
  VolumeX,
  Wind,
  Zap,
} from 'lucide-react';
import { extractFeatureVector, resetFeatureVectorCache } from './analysis/featureVector';
import {
  ANALYSIS_HEIGHT,
  ANALYSIS_WIDTH,
  loadGIBSFrame,
  renderProceduralFrame,
} from './analysis/pixelScanner';
import {
  computeSolarActivityTelemetry,
  fetchLiveSolarKp,
} from './analysis/solarActivity';
import {
  buildWindVectorField,
  sampleWindAlongHeading,
  WindVectorField,
} from './analysis/windVectorField';
import {
  AudioEngine,
  DopplerShiftTelemetry,
  EnvironmentReverbMode,
  SpatialPanningMode,
} from './audio/audioEngine';
import { quantizeToPentatonic, SCALE_DEFINITIONS, ScaleMode } from './audio/scales';
import { AudioSpectrumBar } from './components/AudioSpectrumBar';
import { BrandLogo } from './components/BrandLogo';
import { OnboardingOverlay } from './components/OnboardingOverlay';
import {
  AuroralPulseSignal,
  RadarCompassHud,
  SolarFlareSignal,
} from './components/RadarCompassHud';
import { ProjectionMode, SatelliteMapCanvas } from './components/SatelliteMapCanvas';
import {
  computePearsonCorrelation,
  CorrelationSamplePoint,
  SignalCorrelationPlot,
} from './components/SignalCorrelationPlot';
import { TactileSwitchToggle } from './components/TactileSwitchToggle';
import { TemporalTrendsChart } from './components/TemporalTrendsChart';
import {
  applyThemeCssVars,
  BEA_THEMES,
  isThemeId,
  THEME_ORDER,
  ThemeId,
} from './theme/themes';
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
const THEME_STORAGE_KEY = 'bea_color_theme_v1';

function hasCompletedOnboarding(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function getInitialThemeId(): ThemeId {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeId(saved)) {
      return saved;
    }
    return window.localStorage.getItem(NIGHT_MODE_STORAGE_KEY) === '1' ? 'night' : 'obsidian';
  } catch {
    return 'obsidian';
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
  const priorFrameMotionRef = useRef<Partial<Record<LayerKey, number>>>({});
  const currentFrameMotionRef = useRef<Partial<Record<LayerKey, number>>>({});
  const lastDopplerFrameDateRef = useRef<string | null>(null);

  const [utcTimestampMs, setUtcTimestampMs] = useState<number>(() => Date.now());
  const utcClock = getUtcClockString(utcTimestampMs);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isTestingSpatial, setIsTestingSpatial] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [archiveYear, setArchiveYear] = useState<ArchiveYear>(2026);
  const [monthIndex, setMonthIndex] = useState<number>(11);
  const [listenerAngle, setListenerAngle] = useState<number>(0);
  const [activeLayerKey, setActiveLayerKey] = useState<LayerKey>('north');
  const [masterVolume, setMasterVolume] = useState<number>(0.55);
  const [speechEnabled, setSpeechEnabled] = useState<boolean>(false);
  const [scaleMode, setScaleMode] = useState<ScaleMode>('pentatonic');
  const [reverbMode, setReverbMode] = useState<EnvironmentReverbMode>('vacuum');
  const [panningMode, setPanningMode] = useState<SpatialPanningMode>('smooth360');
  const [autoRotateEnabled, setAutoRotateEnabled] = useState<boolean>(false);
  const [magneticSnapEnabled, setMagneticSnapEnabled] = useState<boolean>(false);
  const magneticSnapRef = useRef<boolean>(false);
  const [atmosphericFlowEnabled, setAtmosphericFlowEnabled] = useState<boolean>(true);
  const [windTurbulenceMultiplier, setWindTurbulenceMultiplier] = useState<number>(1.0);
  const [dopplerSensitivity, setDopplerSensitivity] = useState<number>(1.0);
  const [windField, setWindField] = useState<WindVectorField | null>(null);
  const [liveNoaaKp, setLiveNoaaKp] = useState<number | null>(null);
  const [projection, setProjection] = useState<ProjectionMode>('globe');
  const [showAnomalyHeatmap, setShowAnomalyHeatmap] = useState<boolean>(false);
  const [showSolarTerminator, setShowSolarTerminator] = useState<boolean>(true);
  const [showWindFlow, setShowWindFlow] = useState<boolean>(true);
  const [showStormRadar, setShowStormRadar] = useState<boolean>(true);
  const [stormRadarIntensity, setStormRadarIntensity] = useState<number>(1.0);
  const [showSignalCorrelation, setShowSignalCorrelation] = useState<boolean>(true);
  const [themeId, setThemeId] = useState<ThemeId>(() => getInitialThemeId());
  const activeTheme = BEA_THEMES[themeId];
  const observatoryNightMode = activeTheme.isNightFilter;
  const lastStandardThemeRef = useRef<Exclude<ThemeId, 'night'>>(
    themeId === 'night' ? 'obsidian' : themeId
  );
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(() => !hasCompletedOnboarding());
  const [activeTab, setActiveTab] = useState<ReferenceTab>('log');
  const [logFilter, setLogFilter] = useState<'all' | 'solar_storm'>('all');
  const [cadenceMs, setCadenceMs] = useState<number>(2000);
  const [dataSource, setDataSource] = useState<string>('NASA GIBS WMTS');
  const [frameRevision, setFrameRevision] = useState<number>(0);

  const [vectors, setVectors] = useState<Record<LayerKey, FeatureVector>>({
    north: { ...EMPTY_FEATURE_VECTOR },
    east: { ...EMPTY_FEATURE_VECTOR },
    south: { ...EMPTY_FEATURE_VECTOR },
    west: { ...EMPTY_FEATURE_VECTOR },
  });
  const vectorsRef = useRef(vectors);
  vectorsRef.current = vectors;

  const [auroralPulse, setAuroralPulse] = useState<AuroralPulseSignal | null>(null);
  const auroralPulseSeqRef = useRef<number>(0);
  const auroralPulseTimerRef = useRef<number | null>(null);

  const [solarFlareSignal, setSolarFlareSignal] = useState<SolarFlareSignal | null>(null);
  const solarFlareSeqRef = useRef<number>(0);
  const solarFlareTimerRef = useRef<number | null>(null);

  const [frequencies, setFrequencies] = useState<Record<LayerKey, number>>({
    north: 220,
    east: 220,
    south: 220,
    west: 220,
  });

  const [dopplerByLayer, setDopplerByLayer] = useState<Record<LayerKey, DopplerShiftTelemetry>>({
    north: { beta: 0, multiplier: 1, shiftPct: 0, cents: 0, direction: 'flat', motionDelta: 0 },
    east: { beta: 0, multiplier: 1, shiftPct: 0, cents: 0, direction: 'flat', motionDelta: 0 },
    south: { beta: 0, multiplier: 1, shiftPct: 0, cents: 0, direction: 'flat', motionDelta: 0 },
    west: { beta: 0, multiplier: 1, shiftPct: 0, cents: 0, direction: 'flat', motionDelta: 0 },
  });

  const [history, setHistory] = useState<TelemetryPoint[]>([]);
  const [correlationHistory, setCorrelationHistory] = useState<CorrelationSamplePoint[]>([]);
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

  const appendLog = useCallback(
    (
      message: string,
      tone: LogEntry['tone'] = 'info',
      meta?: { category?: LogEntry['category']; solarDetails?: LogEntry['solarDetails'] }
    ) => {
      const entry: LogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString().slice(11, 19),
        message,
        tone,
        category: meta?.category,
        solarDetails: meta?.solarDetails,
      };
      setLogs((prev) => [entry, ...prev].slice(0, 60));
    },
    []
  );

  useEffect(() => {
    const engine = new AudioEngine();
    engine.setAudioEventListener((evt) => {
      if (evt.kind === 'solar_activity') {
        const curVectors = vectorsRef.current;
        let peakKey: LayerKey = evt.layerKey;
        let maxAnomaly = -1;
        for (const k of LAYER_ORDER) {
          const val = curVectors[k]?.climateAnomaly ?? 0;
          if (val > maxAnomaly) {
            maxAnomaly = val;
            peakKey = k;
          }
        }
        const nextSeq = auroralPulseSeqRef.current + 1;
        auroralPulseSeqRef.current = nextSeq;
        setAuroralPulse({
          seq: nextSeq,
          triggeredAtMs: performance.now(),
          intensity: evt.value,
          chimeHz: evt.frequencyHz,
          targetHeadingDeg: NASA_GIBS_LAYERS[peakKey].azimuth,
        });
        if (auroralPulseTimerRef.current !== null) {
          window.clearTimeout(auroralPulseTimerRef.current);
        }
        auroralPulseTimerRef.current = window.setTimeout(() => {
          setAuroralPulse((cur) => (cur && cur.seq === nextSeq ? null : cur));
        }, 1220);
      } else if (evt.kind === 'solar_flare') {
        const nextSeq = solarFlareSeqRef.current + 1;
        solarFlareSeqRef.current = nextSeq;
        setSolarFlareSignal({
          seq: nextSeq,
          triggeredAtMs: performance.now(),
          solarWindKms: Math.round(evt.value),
          sweepStartHz: evt.frequencyHz,
        });
        if (solarFlareTimerRef.current !== null) {
          window.clearTimeout(solarFlareTimerRef.current);
        }
        solarFlareTimerRef.current = window.setTimeout(() => {
          setSolarFlareSignal((cur) => (cur && cur.seq === nextSeq ? null : cur));
        }, 760);
      }

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
    const announcer = new AccessibilityAnnouncer();
    announcer.attachElement(ariaLiveElRef.current);
    announcer.attachAudioOutput(() => audioEngineRef.current?.getOutputAudioNodes() ?? null);
    announcer.setSpeechStateListener((speaking, recoveryDelaySec) => {
      audioEngineRef.current?.setNarrationActive(speaking, recoveryDelaySec);
    });
    announcerRef.current = announcer;

    const clockInterval = window.setInterval(() => {
      setUtcTimestampMs(Date.now());
    }, 1000);

    const refreshKp = () => {
      void fetchLiveSolarKp().then((kp) => {
        if (kp !== null) setLiveNoaaKp(kp);
      });
    };
    refreshKp();
    const kpInterval = window.setInterval(refreshKp, 300_000);

    return () => {
      window.clearInterval(clockInterval);
      window.clearInterval(kpInterval);
      if (sequencerTimerRef.current !== null) {
        window.clearTimeout(sequencerTimerRef.current);
      }
      if (auroralPulseTimerRef.current !== null) {
        window.clearTimeout(auroralPulseTimerRef.current);
      }
      if (solarFlareTimerRef.current !== null) {
        window.clearTimeout(solarFlareTimerRef.current);
      }
      engine.setAudioEventListener(null);
      engine.dispose();
      announcer.attachAudioOutput(null);
      announcer.setSpeechStateListener(null);
      announcer.dispose();
    };
  }, []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    activeLayerRef.current = activeLayerKey;
  }, [activeLayerKey]);

  useEffect(() => {
    applyThemeCssVars(activeTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, activeTheme.id);
      window.localStorage.setItem(NIGHT_MODE_STORAGE_KEY, activeTheme.isNightFilter ? '1' : '0');
    } catch {
      // Ignore storage restrictions
    }
  }, [activeTheme]);

  const computeLayerDopplers = useCallback(
    (
      vecs: Record<LayerKey, FeatureVector>,
      targetCadenceMs: number,
      dateStr?: string
    ): Record<LayerKey, DopplerShiftTelemetry> => {
      if (audioEngineRef.current) {
        return audioEngineRef.current.computeFilteredDopplerMap(vecs, targetCadenceMs, dateStr);
      }
      const prevMap = priorFrameMotionRef.current;
      return {
        north: AudioEngine.computeDopplerShift(vecs.north.motion, targetCadenceMs, prevMap.north),
        east: AudioEngine.computeDopplerShift(vecs.east.motion, targetCadenceMs, prevMap.east),
        south: AudioEngine.computeDopplerShift(vecs.south.motion, targetCadenceMs, prevMap.south),
        west: AudioEngine.computeDopplerShift(vecs.west.motion, targetCadenceMs, prevMap.west),
      };
    },
    []
  );

  const recomputeFrequencies = useCallback(
    (
      vecs: Record<LayerKey, FeatureVector>,
      mode: ScaleMode,
      dopplers: Record<LayerKey, DopplerShiftTelemetry>
    ): Record<LayerKey, number> => {
      const applyDoppler = (key: LayerKey) => {
        const base = quantizeToPentatonic(vecs[key].hue, vecs[key].brightness, mode).frequency;
        return base * dopplers[key].multiplier;
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

        if (dateStr !== lastDopplerFrameDateRef.current) {
          priorFrameMotionRef.current = { ...currentFrameMotionRef.current };
          for (const key of LAYER_ORDER) {
            currentFrameMotionRef.current[key] = nextVectors[key].motion;
          }
          lastDopplerFrameDateRef.current = dateStr;
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

        const nextDopplers = computeLayerDopplers(nextVectors, nextCadence, dateStr);
        setDopplerByLayer(nextDopplers);
        const nextFreqs = recomputeFrequencies(nextVectors, scaleMode, nextDopplers);
        setFrequencies(nextFreqs);

        if (magneticSnapRef.current && audioEngineRef.current) {
          audioEngineRef.current.setLatestVectors(nextVectors);
          const snap = audioEngineRef.current.resolveMagneticSnap(
            listenerAngleRef.current,
            nextVectors
          );
          if (snap.snappedAngle !== listenerAngleRef.current) {
            listenerAngleRef.current = snap.snappedAngle;
            setListenerAngle(snap.snappedAngle);
            setActiveLayerKey(snap.targetKey);
            activeLayerRef.current = snap.targetKey;
            audioEngineRef.current.setHeading(snap.snappedAngle, 0.14);
          }
        }

        if (updateAudio && audioEngineRef.current?.isRunning()) {
          audioEngineRef.current.updateAllLayers(nextVectors, nextCadence, dateStr);
        } else {
          audioEngineRef.current?.evaluateArchiveEvents(nextVectors, nextCadence, dateStr);
        }

        const nextWindField = await buildWindVectorField(dateStr, canvases.south, canvases.east);
        setWindField(nextWindField);
        audioEngineRef.current?.updateWindField(nextWindField);

        const frameSolar = computeSolarActivityTelemetry(
          Date.now(),
          dateStr,
          nextVectors,
          nextWindField,
          liveNoaaKp
        );
        const refHz = nextFreqs[activeLayerRef.current] ?? 220;
        const solarEvent = audioEngineRef.current?.evaluateSolarActivity(
          frameSolar,
          dateStr,
          false,
          refHz
        );
        if (solarEvent) {
          const kp = frameSolar.kpIndex;
          const stormScale =
            kp >= 8 ? 'G4' : kp >= 7 ? 'G3' : kp >= 6 ? 'G2' : kp >= 5 ? 'G1' : 'SURGE';
          const baseHz = Math.max(98, Math.round(refHz));
          const freqDeltaHz = Math.max(
            2,
            Math.round(baseHz * Math.max(0.012, (solarEvent.value - 0.45) * 0.065))
          );
          const peakChimeHz = Math.round(solarEvent.frequencyHz * 3.17);
          appendLog(
            `SOLAR STORM (${stormScale}) · KP ${kp.toFixed(
              1
            )} · AURORAL SURGE ${Math.round(solarEvent.value * 100)}% · FREQ IMPACT +${freqDeltaHz} HZ (${baseHz}→${
              baseHz + freqDeltaHz
            } HZ) / CHIME ${solarEvent.frequencyHz}–${peakChimeHz} HZ`,
            'warn',
            {
              category: 'solar_storm',
              solarDetails: {
                kpIndex: kp,
                stormScale,
                auroralPotentialPct: Math.round(solarEvent.value * 100),
                chimeHz: solarEvent.frequencyHz,
                freqDeltaHz,
                affectedFreqRangeHz: `${solarEvent.frequencyHz}–${peakChimeHz} Hz`,
              },
            }
          );
        }

        const flareEvent = audioEngineRef.current?.evaluateSolarWindFlare(
          frameSolar,
          dateStr,
          false
        );
        if (flareEvent) {
          appendLog(flareEvent.message, 'coral', { category: 'solar_storm' });
        }

        const intensity = Number(
          ((currentLayerVec.brightness + currentLayerVec.saturation) / 2).toFixed(3)
        );
        const anomaly = Number(currentLayerVec.climateAnomaly.toFixed(3));
        const dopplerShift = nextDopplers[activeLayerRef.current];
        const signedShiftStr = `${
          dopplerShift.shiftPct >= 0 ? '+' : ''
        }${dopplerShift.shiftPct.toFixed(1)}%`;
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

        setCorrelationHistory((prev) => {
          const prior = prev
            .filter((item) => item.dateStr !== dateStr)
            .map((item) => ({ ...item, isCurrentFrame: false }));
          const currentFramePts: CorrelationSamplePoint[] = LAYER_ORDER.map((k) => ({
            id: `${dateStr}-${k}`,
            dateStr,
            layerKey: k,
            brightness: nextVectors[k].brightness,
            climateAnomaly: nextVectors[k].climateAnomaly,
            isCurrentFrame: true,
          }));
          return [...prior, ...currentFramePts].slice(-48);
        });

        if (targetMonth === 9) {
          appendLog(
            `${dateStr} BENCHMARK · ARCTIC SUMMER MINIMUM · ANOMALY ${(anomaly * 100).toFixed(
              1
            )}% · DOPPLER ${signedShiftStr}`,
            'coral'
          );
        } else {
          appendLog(
            `INGESTED ${dateStr} · ${primarySource.toUpperCase()} · CADENCE ${nextCadence}MS · DOPPLER ${signedShiftStr}`,
            'info'
          );
        }

        return nextCadence;
      } finally {
        isLoadingRef.current = false;
        setIsLoading(false);
      }
    },
    [appendLog, computeLayerDopplers, liveNoaaKp, recomputeFrequencies, scaleMode]
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

  const listenerAngleRef = useRef<number>(0);

  const handleSetHeading = useCallback(
    (rawAngleDeg: number, customAnnouncement?: string, directionStepHint?: -1 | 1) => {
      setAutoRotateEnabled(false);
      const normalizedRaw = ((Math.round(rawAngleDeg) % 360) + 360) % 360;
      let effectiveAngle =
        panningMode === 'cardinal'
          ? ((Math.round(normalizedRaw / 90) * 90) % 360 + 360) % 360
          : normalizedRaw;

      const engine = audioEngineRef.current;
      if (magneticSnapRef.current && engine) {
        engine.setLatestVectors(vectors);
        const snap = engine.resolveMagneticSnap(normalizedRaw, vectors, directionStepHint);
        effectiveAngle = snap.snappedAngle;
      }

      const nearestKey = azimuthToLayerKey(effectiveAngle);
      const meta = NASA_GIBS_LAYERS[nearestKey];
      const prevAngle = listenerAngleRef.current;

      listenerAngleRef.current = effectiveAngle;
      setListenerAngle(effectiveAngle);
      setActiveLayerKey(nearestKey);
      activeLayerRef.current = nearestKey;
      engine?.setLatestVectors(vectors);
      engine?.setHeading(effectiveAngle);

      const vec = vectors[nearestKey];
      if (vec) {
        const nextCadence = Math.round(2500 - vec.motion * 1000);
        const nextDopplers = computeLayerDopplers(vectors, nextCadence);
        setCadenceMs(nextCadence);
        setDopplerByLayer(nextDopplers);
        setFrequencies(recomputeFrequencies(vectors, scaleMode, nextDopplers));
      }

      setFrameRevision((r) => r + 1);
      if (!magneticSnapRef.current || effectiveAngle !== prevAngle) {
        appendLog(
          `HEADING ${String(effectiveAngle).padStart(3, '0')}° · ${
            magneticSnapRef.current
              ? 'MAGNETIC ANOMALY LOCK'
              : panningMode === 'smooth360'
              ? '360° SMOOTH HRTF'
              : 'CARDINAL SNAP'
          } · FOCUS ${meta.cardinal.toUpperCase()} (${meta.domain.toUpperCase()})`,
          magneticSnapRef.current ? 'coral' : 'mint'
        );
      }
      announcerRef.current?.announce(
        customAnnouncement ??
          `Facing ${effectiveAngle} degrees, nearest cardinal ${meta.cardinal}. Active observation: ${meta.phenomenon}.`
      );
    },
    [appendLog, computeLayerDopplers, panningMode, recomputeFrequencies, scaleMode, vectors]
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
      handleSetHeading(listenerAngle - stepDeg, undefined, -1);
    },
    [handleSetHeading, listenerAngle]
  );

  const handleRotateRight = useCallback(
    (stepDeg: number) => {
      handleSetHeading(listenerAngle + stepDeg, undefined, 1);
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
      priorFrameMotionRef.current = {};
      currentFrameMotionRef.current = {};
      lastDopplerFrameDateRef.current = null;
      audioEngineRef.current?.resetArchiveEventHistory();
      setHistory([]);
      setCorrelationHistory([]);
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
    const nextDopplers = computeLayerDopplers(vectors, cadenceMs);
    setDopplerByLayer(nextDopplers);
    const nextFreqs = recomputeFrequencies(vectors, mode, nextDopplers);
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

  const handleToggleWindFlow = useCallback(() => {
    setShowWindFlow((prev) => {
      const next = !prev;
      appendLog(
        `WIND FLOW STREAMLINE ANIMATION ${next ? 'ENABLED' : 'DISABLED'}`,
        next ? 'mint' : 'info'
      );
      announcerRef.current?.announceImmediate(
        `Wind flow streamline animation ${next ? 'enabled' : 'disabled'}.`
      );
      return next;
    });
  }, [appendLog]);

  const handleToggleStormRadar = useCallback(() => {
    setShowStormRadar((prev) => {
      const next = !prev;
      appendLog(
        `D3 STORM RADAR PRESSURE CONTOURS ${next ? 'ENABLED' : 'DISABLED'}`,
        next ? 'coral' : 'info'
      );
      announcerRef.current?.announceImmediate(
        `Storm radar pressure contour overlay ${next ? 'enabled' : 'disabled'}.`
      );
      return next;
    });
  }, [appendLog]);

  const handleChangeStormRadarIntensity = useCallback((intensity: number) => {
    const clamped = Math.max(0, Math.min(2.0, Number.isFinite(intensity) ? intensity : 1.0));
    setStormRadarIntensity(clamped);
    if (clamped > 0.01) {
      setShowStormRadar(true);
    }
  }, []);

  const handleToggleSignalCorrelation = useCallback(() => {
    setShowSignalCorrelation((prev) => {
      const next = !prev;
      appendLog(
        `SIGNAL CORRELATION D3 SCATTER ${next ? 'ENABLED' : 'COLLAPSED'} (BRIGHTNESS × ANOMALY)`,
        next ? 'mint' : 'info'
      );
      announcerRef.current?.announceImmediate(
        `Signal correlation scatter plot ${next ? 'enabled' : 'hidden'}.`
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

  const handleSelectTheme = useCallback(
    (nextId: ThemeId) => {
      if (nextId !== 'night') {
        lastStandardThemeRef.current = nextId;
      }
      setThemeId(nextId);
      const meta = BEA_THEMES[nextId];
      appendLog(
        `COLOR THEME -> ${meta.label.toUpperCase()} (${meta.description.toUpperCase()})`,
        meta.isNightFilter ? 'coral' : 'mint'
      );
      announcerRef.current?.announceImmediate(
        `Color theme set to ${meta.label}. ${meta.description}.`
      );
    },
    [appendLog]
  );

  const handleToggleNightMode = useCallback(() => {
    setThemeId((prevId) => {
      const enteringNight = prevId !== 'night';
      if (!enteringNight) {
        const restoreId = lastStandardThemeRef.current;
        const restoreMeta = BEA_THEMES[restoreId];
        appendLog(
          `OBSERVATORY NIGHT MODE DISABLED · ${restoreMeta.label.toUpperCase()} SPECTRUM RESTORED`,
          'info'
        );
        announcerRef.current?.announceImmediate(
          `Observatory night mode disabled. ${restoreMeta.label} spectrum restored.`
        );
        return restoreId;
      }
      lastStandardThemeRef.current = prevId;
      appendLog(
        'OBSERVATORY NIGHT MODE ENABLED · DEEP RED DARK-ADAPTATION PALETTE & REDUCED CANVAS BLOOM',
        'coral'
      );
      announcerRef.current?.announceImmediate(
        'Observatory night mode enabled. Deep red dark adaptation palette active and canvas bloom reduced.'
      );
      return 'night';
    });
  }, [appendLog]);

  const handlePanningModeChange = useCallback(
    (mode: SpatialPanningMode) => {
      setPanningMode(mode);
      audioEngineRef.current?.setPanningMode(mode);
      if (mode === 'cardinal') {
        setAutoRotateEnabled(false);
        const snapped = ((Math.round(listenerAngle / 90) * 90) % 360 + 360) % 360;
        const nearestKey = azimuthToLayerKey(snapped);
        listenerAngleRef.current = snapped;
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

  const handleToggleAutoRotate = useCallback(() => {
    setAutoRotateEnabled((prev) => {
      const next = !prev;
      if (next && panningMode === 'cardinal') {
        setPanningMode('smooth360');
        audioEngineRef.current?.setPanningMode('smooth360');
      }
      if (next && magneticSnapRef.current) {
        magneticSnapRef.current = false;
        setMagneticSnapEnabled(false);
        audioEngineRef.current?.setMagneticSnapEnabled(false);
      }
      appendLog(
        next
          ? 'AUTO-ROTATE 360° SOUNDFIELD SCAN ENABLED (5°/SEC)'
          : 'AUTO-ROTATE 360° SCAN PAUSED',
        next ? 'mint' : 'info'
      );
      announcerRef.current?.announceImmediate(
        next
          ? 'Auto-rotate enabled. Panning binaural heading continuously at 5 degrees per second.'
          : 'Auto-rotate disabled.'
      );
      return next;
    });
  }, [appendLog, panningMode]);

  const handleToggleMagneticSnap = useCallback(() => {
    const next = !magneticSnapRef.current;
    magneticSnapRef.current = next;
    setMagneticSnapEnabled(next);
    const engine = audioEngineRef.current;
    engine?.setLatestVectors(vectors);

    if (next) {
      setAutoRotateEnabled(false);
      engine?.setMagneticSnapEnabled(true);
      const snap = engine?.resolveMagneticSnap(listenerAngleRef.current, vectors);
      if (snap) {
        const meta = NASA_GIBS_LAYERS[snap.targetKey];
        listenerAngleRef.current = snap.snappedAngle;
        setListenerAngle(snap.snappedAngle);
        setActiveLayerKey(snap.targetKey);
        activeLayerRef.current = snap.targetKey;
        const vec = vectors[snap.targetKey];
        if (vec) {
          const nextCadence = Math.round(2500 - vec.motion * 1000);
          const nextDopplers = computeLayerDopplers(vectors, nextCadence);
          setCadenceMs(nextCadence);
          setDopplerByLayer(nextDopplers);
          setFrequencies(recomputeFrequencies(vectors, scaleMode, nextDopplers));
        }
        appendLog(
          `MAGNETIC SNAP ENABLED · LOCKED TO ${meta.cardinal.toUpperCase()} (${String(
            snap.snappedAngle
          ).padStart(3, '0')}°) · ANOMALY ${(snap.anomalyIntensity * 100).toFixed(1)}%`,
          'coral'
        );
        announcerRef.current?.announceImmediate(
          `Magnetic snap enabled. Heading aligned to ${meta.cardinal} anomaly center at ${snap.snappedAngle} degrees.`
        );
        return;
      }
      appendLog('MAGNETIC SNAP ENABLED · ALIGNING TO HIGH-ANOMALY CENTERS', 'coral');
      announcerRef.current?.announceImmediate('Magnetic snap enabled.');
    } else {
      engine?.setMagneticSnapEnabled(false);
      appendLog('MAGNETIC SNAP DISABLED · FREE HEADING CONTROL RESTORED', 'info');
      announcerRef.current?.announceImmediate('Magnetic snap disabled.');
    }
  }, [appendLog, computeLayerDopplers, recomputeFrequencies, scaleMode, vectors]);

  const autoRotateDataRef = useRef({ vectors, scaleMode, computeLayerDopplers, recomputeFrequencies });
  autoRotateDataRef.current = { vectors, scaleMode, computeLayerDopplers, recomputeFrequencies };

  useEffect(() => {
    if (!autoRotateEnabled || isOnboardingOpen || isTestingSpatial) return;

    let rafId = 0;
    let lastTs = performance.now();
    const AUTO_ROTATE_DEG_PER_SEC = 5;

    const tick = (now: number) => {
      const dtSec = Math.min(0.1, Math.max(0, (now - lastTs) / 1000));
      lastTs = now;

      const nextAngle =
        (((listenerAngleRef.current + AUTO_ROTATE_DEG_PER_SEC * dtSec) % 360) + 360) % 360;
      listenerAngleRef.current = nextAngle;
      setListenerAngle(nextAngle);
      audioEngineRef.current?.setHeading(nextAngle, 0.02);

      const nearestKey = azimuthToLayerKey(nextAngle);
      if (nearestKey !== activeLayerRef.current) {
        activeLayerRef.current = nearestKey;
        setActiveLayerKey(nearestKey);
        const {
          vectors: curVectors,
          scaleMode: curScale,
          computeLayerDopplers: calcDopplers,
          recomputeFrequencies: calcFreqs,
        } = autoRotateDataRef.current;
        const vec = curVectors[nearestKey];
        if (vec) {
          const nextCadence = Math.round(2500 - vec.motion * 1000);
          const nextDopplers = calcDopplers(curVectors, nextCadence);
          setCadenceMs(nextCadence);
          setDopplerByLayer(nextDopplers);
          setFrequencies(calcFreqs(curVectors, curScale, nextDopplers));
        }
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [autoRotateEnabled, isOnboardingOpen, isTestingSpatial]);

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

  const handleWindTurbulenceChange = useCallback((multiplier: number) => {
    const clamped = Math.max(0, Math.min(2.5, Number.isFinite(multiplier) ? multiplier : 1.0));
    setWindTurbulenceMultiplier(clamped);
    audioEngineRef.current?.setWindTurbulenceMultiplier(clamped);
  }, []);

  const handleDopplerSensitivityChange = useCallback(
    (sensitivity: number) => {
      const clamped = Math.max(0, Math.min(3.0, Number.isFinite(sensitivity) ? sensitivity : 1.0));
      setDopplerSensitivity(clamped);
      audioEngineRef.current?.setDopplerSensitivity(clamped);
      const nextDopplers = computeLayerDopplers(vectors, cadenceMs);
      setDopplerByLayer(nextDopplers);
      setFrequencies(recomputeFrequencies(vectors, scaleMode, nextDopplers));
      if (audioEngineRef.current?.isRunning()) {
        audioEngineRef.current.updateAllLayers(vectors, cadenceMs);
      }
    },
    [cadenceMs, computeLayerDopplers, recomputeFrequencies, scaleMode, vectors]
  );

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
    onToggleWindFlow: handleToggleWindFlow,
    onToggleStormRadar: handleToggleStormRadar,
    onToggleReverb: handleToggleReverb,
    onTogglePanningMode: handleTogglePanningMode,
    onToggleAutoRotate: handleToggleAutoRotate,
    onToggleMagneticSnap: handleToggleMagneticSnap,
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
  const correlationPoints = useMemo<CorrelationSamplePoint[]>(() => {
    if (correlationHistory.length > 0) return correlationHistory;
    return LAYER_ORDER.map((k) => ({
      id: `${activeDateStr}-${k}`,
      dateStr: activeDateStr,
      layerKey: k,
      brightness: vectors[k].brightness,
      climateAnomaly: vectors[k].climateAnomaly,
      isCurrentFrame: true,
    }));
  }, [correlationHistory, activeDateStr, vectors]);

  const correlationStats = useMemo(
    () => computePearsonCorrelation(correlationPoints),
    [correlationPoints]
  );

  const solarTelemetry = useMemo(
    () =>
      computeSolarActivityTelemetry(
        utcTimestampMs,
        activeDateStr,
        vectors,
        windField,
        liveNoaaKp
      ),
    [utcTimestampMs, activeDateStr, vectors, windField, liveNoaaKp]
  );

  const logSolarStormSurge = useCallback(
    (
      telemetry: ReturnType<typeof computeSolarActivityTelemetry>,
      evt: AudioEventEntry,
      refFreqHz: number
    ) => {
      const kp = telemetry.kpIndex;
      const stormScale =
        kp >= 8 ? 'G4' : kp >= 7 ? 'G3' : kp >= 6 ? 'G2' : kp >= 5 ? 'G1' : 'SURGE';
      const baseHz = Math.max(98, Math.round(refFreqHz || 220));
      const freqDeltaHz = Math.max(
        2,
        Math.round(baseHz * Math.max(0.012, (evt.value - 0.45) * 0.065))
      );
      const peakChimeHz = Math.round(evt.frequencyHz * 3.17);
      appendLog(
        `SOLAR STORM (${stormScale}) · KP ${kp.toFixed(1)} · AURORAL SURGE ${Math.round(
          evt.value * 100
        )}% · FREQ IMPACT +${freqDeltaHz} HZ (${baseHz}→${baseHz + freqDeltaHz} HZ) / CHIME ${
          evt.frequencyHz
        }–${peakChimeHz} HZ`,
        'warn',
        {
          category: 'solar_storm',
          solarDetails: {
            kpIndex: kp,
            stormScale,
            auroralPotentialPct: Math.round(evt.value * 100),
            chimeHz: evt.frequencyHz,
            freqDeltaHz,
            affectedFreqRangeHz: `${evt.frequencyHz}–${peakChimeHz} Hz`,
          },
        }
      );
    },
    [appendLog]
  );

  const activeFreqRef = useRef<number>(220);
  activeFreqRef.current = frequencies[activeLayerKey] ?? 220;

  // Continuously monitor real-time solar activity telemetry and automatically log Solar Storm & Solar Flare surges
  useEffect(() => {
    const refHz = activeFreqRef.current;
    const evt = audioEngineRef.current?.evaluateSolarActivity(
      solarTelemetry,
      activeDateStr,
      false,
      refHz
    );
    if (evt) {
      logSolarStormSurge(solarTelemetry, evt, refHz);
    }
    const flareEvt = audioEngineRef.current?.evaluateSolarWindFlare(
      solarTelemetry,
      activeDateStr,
      false
    );
    if (flareEvt) {
      appendLog(flareEvt.message, 'coral', { category: 'solar_storm' });
    }
  }, [activeDateStr, appendLog, logSolarStormSurge, solarTelemetry]);

  const handleTriggerSolarTest = useCallback(async () => {
    const engine = audioEngineRef.current;
    if (!engine) return;
    const refHz = frequencies[activeLayerKey] ?? 220;
    const simulatedPeak = {
      ...solarTelemetry,
      kpIndex: Math.max(6.2, solarTelemetry.kpIndex),
      auroralPotentialPct: Math.max(82, solarTelemetry.auroralPotentialPct),
      intensity: Math.max(0.82, solarTelemetry.intensity),
      solarWindKms: Math.max(640, solarTelemetry.solarWindKms),
      regimeLabel: 'GEOMAGNETIC STORM' as const,
    };
    const evt = await engine.triggerSolarAuroraPing(simulatedPeak, activeDateStr, refHz);
    if (evt) {
      logSolarStormSurge(simulatedPeak, evt, refHz);
      announcerRef.current?.announceImmediate(
        `Solar storm alert. K p ${simulatedPeak.kpIndex.toFixed(
          1
        )}, auroral potential ${simulatedPeak.auroralPotentialPct} percent.`
      );
    }
  }, [activeDateStr, activeLayerKey, frequencies, logSolarStormSurge, solarTelemetry]);

  const handleTriggerSolarFlareTest = useCallback(async () => {
    const engine = audioEngineRef.current;
    if (!engine) return;
    const simulatedFlare = {
      ...solarTelemetry,
      kpIndex: Math.max(7.1, solarTelemetry.kpIndex),
      auroralPotentialPct: Math.max(88, solarTelemetry.auroralPotentialPct),
      intensity: Math.max(0.9, solarTelemetry.intensity),
      solarWindKms: Math.max(765, solarTelemetry.solarWindKms + 180),
      regimeLabel: 'GEOMAGNETIC STORM' as const,
    };
    const evt = await engine.triggerSolarFlarePing(simulatedFlare, activeDateStr);
    if (evt) {
      appendLog(evt.message, 'coral', { category: 'solar_storm' });
      announcerRef.current?.announceImmediate(
        `Solar flare warning. Solar wind spike ${simulatedFlare.solarWindKms} kilometers per second.`
      );
    }
  }, [activeDateStr, appendLog, solarTelemetry]);
  const maxMonth = getMaxMonthForYear(archiveYear);
  const benchmarks = getSeasonalBenchmarks(archiveYear);
  const activeCanvas = offscreenMapRef.current?.[activeLayerKey] ?? null;
  const sstCanvas = offscreenMapRef.current?.south ?? null;
  const activeDoppler = dopplerByLayer[activeLayerKey];
  const activePitchHz = frequencies[activeLayerKey] ?? 220;
  const activeFilterHz = Math.round(400 + activeVector.saturation * 5600);
  const activeNoteDegree = Math.floor(activeVector.hue * 9.99) + 1;
  const formatSignedDopplerPct = (shiftPct: number) =>
    `${shiftPct >= 0 ? '+' : ''}${shiftPct.toFixed(1)}%`;
  const formatSignedCents = (cents: number) => `${cents >= 0 ? '+' : ''}${cents}¢`;

  const signalRows: Array<{
    label: string;
    value: number;
    target: string;
    isCoral: boolean;
    doppler?: DopplerShiftTelemetry;
  }> = [
    {
      label: 'Brightness',
      value: activeVector.brightness,
      target: `${activePitchHz.toFixed(0)} Hz (${activeDoppler.multiplier.toFixed(3)}×)`,
      isCoral: false,
      doppler: activeDoppler,
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
      target: `${cadenceMs} ms · ${formatSignedDopplerPct(activeDoppler.shiftPct)} (${formatSignedCents(
        activeDoppler.cents
      )})`,
      isCoral: false,
      doppler: activeDoppler,
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
        className="border-b border-[var(--border-strong)] bg-[var(--bg-console)]"
      >
        <div className="max-w-[1680px] mx-auto w-full px-4 lg:px-5 py-2.5 flex flex-wrap xl:flex-nowrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 shrink-0">
            <BrandLogo size={32} nightMode={observatoryNightMode} theme={activeTheme} />
            <h1 className="text-base sm:text-lg font-bold tracking-tight whitespace-nowrap">
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage: `linear-gradient(to right, ${activeTheme.titleGradient[0]}, ${activeTheme.titleGradient[1]}, ${activeTheme.titleGradient[2]})`,
                }}
              >
                Binaural Earth
              </span>{' '}
              <span className="text-[var(--text-primary)]">Atlas</span>
            </h1>
            <span className="hidden 2xl:inline text-xs font-mono-tabular text-[var(--text-muted)] whitespace-nowrap">
              · Orbital Acoustic Observatory
            </span>
          </div>

          <div className="hidden lg:flex items-center gap-3 text-xs font-mono-tabular whitespace-nowrap px-3 py-1 border border-[var(--border-grid)] bg-[var(--bg-obsidian)]">
            <span className="text-[var(--text-muted)]">
              EPOCH <strong className="text-[var(--accent-mint)] font-semibold">{activeDateStr}</strong>
            </span>
            <span className="text-[var(--border-strong)]" aria-hidden="true">|</span>
            <span className="text-[var(--text-muted)]">
              HDG{' '}
              <strong className="text-[var(--text-primary)] font-semibold">
                {String(Math.round(listenerAngle)).padStart(3, '0')}° {activeLayer.shortCardinal}
              </strong>
            </span>
            <span className="text-[var(--border-strong)]" aria-hidden="true">|</span>
            <span className="text-[var(--text-muted)]">
              KP{' '}
              <strong className="text-[var(--accent-amber)] font-semibold">
                {solarTelemetry.kpIndex.toFixed(1)}
              </strong>
            </span>
            <span className="hidden 2xl:inline text-[var(--border-strong)]" aria-hidden="true">|</span>
            <span className="hidden 2xl:inline text-[var(--text-muted)]">{utcClock}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap">
            <button
              ref={guideButtonRef}
              type="button"
              onClick={() => setIsOnboardingOpen(true)}
              aria-haspopup="dialog"
              className="min-h-[34px] px-2.5 py-1.5 border border-[var(--border-strong)] bg-[var(--bg-control)] text-xs font-mono-tabular text-[var(--text-primary)] hover:border-[var(--accent-mint)] hover:text-[var(--accent-mint)] flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Guide</span>
            </button>

            <div
              className="min-h-[34px] px-2 border border-[var(--border-strong)] bg-[var(--bg-control)] hover:border-[var(--accent-mint)] focus-within:border-[var(--accent-mint)] flex items-center gap-1.5 shrink-0"
              title={`Observatory Color Theme: ${activeTheme.label} — ${activeTheme.description}`}
            >
              <Palette className="w-3.5 h-3.5 text-[var(--accent-mint)] shrink-0" aria-hidden="true" />
              <select
                aria-label="Observatory Color Theme"
                value={themeId}
                onChange={(e) => {
                  const nextVal = e.target.value;
                  if (isThemeId(nextVal)) {
                    handleSelectTheme(nextVal);
                  }
                }}
                className="bg-transparent text-xs font-mono-tabular text-[var(--text-primary)] focus:outline-none cursor-pointer pr-1 py-1 whitespace-nowrap"
              >
                {THEME_ORDER.map((id) => (
                  <option
                    key={id}
                    value={id}
                    className="bg-[var(--bg-console)] text-[var(--text-primary)]"
                  >
                    {BEA_THEMES[id].label}
                  </option>
                ))}
              </select>
            </div>

            <TactileSwitchToggle
              checked={speechEnabled}
              onToggle={handleToggleSpeech}
              label="Speech"
              accent="mint"
              icon={<Speech className="w-3.5 h-3.5" />}
              title="Toggle spoken screen-reader accessibility telemetry updates"
            />

            <TactileSwitchToggle
              checked={observatoryNightMode}
              onToggle={handleToggleNightMode}
              label="Night Mode"
              shortcut="N"
              accent="amber"
              icon={<Moon className="w-3.5 h-3.5" />}
              title="Observatory Night Mode (N) — High-contrast deep red palette & reduced canvas bloom"
            />

            <button
              type="button"
              onClick={() => void handleTogglePlay()}
              aria-pressed={isPlaying}
              className={`min-h-[34px] px-4 py-1.5 border text-xs font-bold uppercase tracking-wider flex items-center gap-2 cursor-pointer whitespace-nowrap ${
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
        </div>
      </header>

      {/* MAIN OBSERVATORY STAGE: FLUID DESKTOP VIEWPORT & DEDICATED TELEMETRY SIDEBAR */}
      <main className="flex-1 w-full max-w-[1680px] mx-auto 2xl:border-x border-[var(--border-grid)] grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_430px] xl:grid-cols-[minmax(0,1fr)_480px] 2xl:grid-cols-[minmax(0,1fr)_520px]">
        {/* LEFT / CENTER STAGE */}
        <div className="p-3 lg:p-4 flex flex-col gap-3.5 border-b lg:border-b-0 lg:border-r border-[var(--border-grid)] min-w-0">
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
            showWindFlow={showWindFlow}
            showStormRadar={showStormRadar}
            stormRadarIntensity={stormRadarIntensity}
            utcTimestampMs={utcTimestampMs}
            windField={windField}
            vectors={vectors}
            nightMode={observatoryNightMode}
            theme={activeTheme}
            onToggleProjection={setProjection}
            onToggleAnomalyHeatmap={handleToggleAnomalyHeatmap}
            onToggleSolarTerminator={handleToggleSolarTerminator}
            onToggleWindFlow={handleToggleWindFlow}
            onToggleStormRadar={handleToggleStormRadar}
            onChangeStormRadarIntensity={handleChangeStormRadarIntensity}
            onSelectBookmark={(key, label) => {
              handleSelectLayer(key);
              appendLog(`TARGET LOCKED: ${label.toUpperCase()}`, 'mint');
            }}
          />

          {/* CHRONOLOGY & ACOUSTIC DECK */}
          <section
            aria-label="Satellite Archive Chronology and Acoustic Controls"
            className="border border-[var(--border-strong)] bg-[var(--bg-console)] flex flex-col"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b border-[var(--border-grid)] bg-[var(--bg-panel)]">
              <div className="flex flex-wrap items-center gap-3 min-w-0">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] whitespace-nowrap">
                  Archive Sequencer &amp; Synthesis
                </h2>
                <span className="text-xs font-mono-tabular font-semibold text-[var(--accent-mint)] whitespace-nowrap">
                  {MONTH_NAMES[monthIndex - 1]} {archiveYear} · {cadenceMs} MS
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {/* Archive Year Switcher (2026 / 2025 / 2007) */}
                <div
                  className="flex border border-[var(--border-strong)] bg-[var(--bg-obsidian)]"
                  role="group"
                  aria-label="Archive Year Selector"
                >
                  {ARCHIVE_YEARS.map((yr, idx) => (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => void handleChangeYear(yr)}
                      aria-pressed={archiveYear === yr}
                      className={`px-3 py-1 text-xs font-mono-tabular cursor-pointer whitespace-nowrap ${
                        idx < ARCHIVE_YEARS.length - 1 ? 'border-r border-[var(--border-grid)]' : ''
                      } ${
                        archiveYear === yr
                          ? 'bg-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                          : 'bg-[var(--bg-control)] text-[var(--text-primary)] hover:text-[var(--accent-mint)]'
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
                  className="px-3 py-1 border border-[var(--border-strong)] bg-[var(--bg-control)] text-[var(--text-primary)] hover:border-[var(--accent-mint)] hover:text-[var(--accent-mint)] disabled:opacity-60 text-xs font-mono-tabular flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Radio className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isTestingSpatial ? 'Sweeping N→E→S→W' : 'Test Spatial Sweep'}</span>
                </button>
              </div>
            </div>

            <div className="p-3.5 flex flex-col gap-3">
              {/* Row 1: Unified Timeline + Seasonal Benchmarks & Master Gain */}
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_248px] gap-3 items-stretch">
                {/* Timeline Scrubber + Quick Benchmarks */}
                <div className="border border-[var(--border-strong)] bg-[var(--bg-obsidian)] p-3 flex flex-col justify-between gap-2.5">
                  <div>
                    <div className="flex items-center justify-between text-xs font-mono-tabular mb-2">
                      <label htmlFor="timelineSlider" className="font-semibold text-[var(--text-primary)]">
                        {archiveYear} TIMELINE (JAN – {archiveYear === 2026 ? 'NOV' : 'DEC'})
                      </label>
                      <span className="text-[var(--accent-mint)] font-semibold">{activeDateStr}</span>
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

                  <div
                    className="grid grid-cols-5 gap-1.5 pt-1"
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
                          className={`py-1 px-2 border text-[11px] font-mono-tabular font-semibold cursor-pointer whitespace-nowrap ${
                            isCurrent
                              ? isSep
                                ? 'bg-[var(--accent-coral)] border-[var(--accent-coral)] text-[var(--bg-obsidian)]'
                                : 'bg-[var(--accent-mint)] border-[var(--accent-mint)] text-[var(--bg-obsidian)]'
                              : isSep
                              ? 'bg-[var(--bg-control)] border-[var(--accent-coral)] text-[var(--accent-coral)] hover:bg-[var(--bg-panel)]'
                              : 'bg-[var(--bg-control)] border-[var(--border-strong)] text-[var(--text-primary)] hover:border-[var(--accent-mint)]'
                          }`}
                        >
                          {bm.label}
                        </button>
                      );
                    })}
                  </div>

                  <p className="text-xs text-[var(--text-muted)] leading-relaxed border-t border-[var(--border-grid)] pt-2">
                    {getMonthlyClimateBrief(archiveYear, monthIndex)}
                  </p>
                </div>

                {/* Master Gain & Active Output Readout */}
                <div className="border border-[var(--border-strong)] bg-[var(--bg-obsidian)] p-3 flex flex-col justify-between gap-2.5">
                  <div>
                    <div className="flex items-center justify-between text-xs font-mono-tabular mb-2">
                      <label
                        htmlFor="volumeSlider"
                        className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]"
                      >
                        {masterVolume === 0 ? (
                          <VolumeX className="w-3.5 h-3.5 text-[var(--accent-coral)]" aria-hidden="true" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5 text-[var(--accent-mint)]" aria-hidden="true" />
                        )}
                        <span>MASTER GAIN</span>
                      </label>
                      <span className="text-[var(--accent-mint)] font-semibold">
                        {Math.round(masterVolume * 100)}%
                      </span>
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

                  <div className="border-t border-[var(--border-grid)] pt-2 flex flex-col gap-1 text-[11px] font-mono-tabular text-[var(--text-muted)]">
                    <div className="flex items-center justify-between">
                      <span>CARRIER PITCH</span>
                      <strong className="text-[var(--text-primary)]">{activePitchHz.toFixed(0)} Hz</strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>FILTER CUTOFF</span>
                      <strong className="text-[var(--text-primary)]">{activeFilterHz} Hz</strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>SOLAR WIND</span>
                      <strong className="text-[var(--accent-amber)]">{solarTelemetry.solarWindKms} km/s</strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 2: Balanced 2-Column Synthesis Strip */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
                {/* Harmonic Quantizer & Environment Reverb */}
                <div className="border border-[var(--border-strong)] bg-[var(--bg-obsidian)] p-3 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center justify-between text-[11px] font-mono-tabular mb-2">
                      <span className="font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                        HARMONIC QUANTIZER
                      </span>
                      <span className="text-[var(--accent-mint)] font-semibold uppercase">
                        {SCALE_DEFINITIONS[scaleMode].label}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Harmonic Scale Mode">
                      {(['pentatonic', 'dorian', 'harmonic'] as ScaleMode[]).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => handleScaleModeChange(mode)}
                          aria-pressed={scaleMode === mode}
                          className={`py-1.5 px-2 text-[11px] font-mono-tabular uppercase border cursor-pointer whitespace-nowrap ${
                            scaleMode === mode
                              ? 'bg-[var(--accent-mint)] border-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                              : 'bg-[var(--bg-control)] border-[var(--border-strong)] text-[var(--text-primary)] hover:border-[var(--accent-mint)]'
                          }`}
                        >
                          {mode === 'pentatonic' ? 'PENTA' : mode === 'dorian' ? 'DORIAN' : 'HARM'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-[var(--border-grid)]">
                    <div className="flex items-center justify-between text-[11px] font-mono-tabular mb-2">
                      <span className="font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                        ENVIRONMENT REVERB
                      </span>
                      <span className="text-[var(--accent-mint)] font-semibold">
                        {reverbMode === 'vacuum' ? 'DRY' : 'WET IR'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Environment Reverb">
                      <button
                        type="button"
                        onClick={() => handleReverbModeChange('vacuum')}
                        aria-pressed={reverbMode === 'vacuum'}
                        title="Dry spatial signal with zero reverberation"
                        className={`py-1.5 px-2 text-[11px] font-mono-tabular uppercase border cursor-pointer whitespace-nowrap truncate ${
                          reverbMode === 'vacuum'
                            ? 'bg-[var(--accent-mint)] border-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                            : 'bg-[var(--bg-control)] border-[var(--border-strong)] text-[var(--text-primary)] hover:border-[var(--accent-mint)]'
                        }`}
                      >
                        Vacuum / Space
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReverbModeChange('atmospheric')}
                        aria-pressed={reverbMode === 'atmospheric'}
                        title="2.8s stereo planetary atmospheric convolution reverb"
                        className={`py-1.5 px-2 text-[11px] font-mono-tabular uppercase border cursor-pointer whitespace-nowrap truncate ${
                          reverbMode === 'atmospheric'
                            ? 'bg-[var(--accent-mint)] border-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                            : 'bg-[var(--bg-control)] border-[var(--border-strong)] text-[var(--text-primary)] hover:border-[var(--accent-mint)]'
                        }`}
                      >
                        Atmospheric
                      </button>
                    </div>
                  </div>
                </div>

                {/* Atmospheric Flow Granular Wind Layer */}
                <div className="border border-[var(--border-strong)] bg-[var(--bg-obsidian)] p-3 flex flex-col justify-between gap-2.5">
                  <TactileSwitchToggle
                    checked={atmosphericFlowEnabled}
                    onToggle={handleToggleAtmosphericFlow}
                    label="ATMOS FLOW"
                    shortcut="W"
                    accent="mint"
                    compact
                    icon={<Wind className="w-3.5 h-3.5" />}
                    title="Toggle Atmospheric Flow granular wind noise-floor (Shortcut: W)"
                    className="w-full"
                  />

                  <div className="h-2 w-full bg-[var(--bg-console)] border border-[var(--border-strong)]">
                    <div
                      className={
                        headingWind?.isHighWindOcean
                          ? 'h-full bg-[var(--accent-amber)]'
                          : 'h-full bg-[var(--accent-mint)]'
                      }
                      style={{
                        width: `${
                          atmosphericFlowEnabled && headingWind
                            ? Math.min(
                                100,
                                Math.round(headingWind.intensity * windTurbulenceMultiplier * 100)
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>

                  {/* Wind Turbulence Multiplier Slider */}
                  <div>
                    <div className="flex items-center justify-between text-[11px] font-mono-tabular mb-1.5">
                      <label htmlFor="windTurbulenceSlider" className="text-[var(--text-primary)] font-semibold">
                        WIND TURBULENCE
                      </label>
                      <span
                        className={`font-semibold ${
                          !atmosphericFlowEnabled || windTurbulenceMultiplier === 0
                            ? 'text-[var(--text-muted)]'
                            : windTurbulenceMultiplier > 1.25
                            ? 'text-[var(--accent-amber)]'
                            : 'text-[var(--accent-mint)]'
                        }`}
                      >
                        {windTurbulenceMultiplier.toFixed(2)}×
                      </span>
                    </div>
                    <input
                      id="windTurbulenceSlider"
                      type="range"
                      min={0}
                      max={2.5}
                      step={0.05}
                      value={windTurbulenceMultiplier}
                      onChange={(e) => handleWindTurbulenceChange(parseFloat(e.target.value))}
                      disabled={!atmosphericFlowEnabled}
                      className="scientific-slider disabled:opacity-45"
                      aria-label="Wind turbulence granular synthesis noise-floor multiplier"
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono-tabular text-[var(--text-muted)] gap-2 pt-1.5 border-t border-[var(--border-grid)]">
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
          </section>

          {/* TABBED SCIENTIFIC CONSOLE */}
          <section
            aria-label="Observatory Reference Console"
            className="border border-[var(--border-strong)] bg-[var(--bg-console)] flex flex-col"
          >
            <div className="flex flex-wrap items-center justify-between border-b border-[var(--border-strong)] bg-[var(--bg-panel)] px-3">
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
                    ['manual', 'Keyboard Shortcuts'],
                    ['specs', 'Cardinal & GIBS Specs'],
                  ] as Array<[ReferenceTab, string]>
                ).map(([tabKey, label]) => (
                  <button
                    key={tabKey}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tabKey}
                    onClick={() => setActiveTab(tabKey)}
                    className={`px-3.5 py-2.5 text-xs font-mono-tabular border-r border-[var(--border-grid)] cursor-pointer whitespace-nowrap ${
                      activeTab === tabKey
                        ? tabKey === 'audio-events'
                          ? 'bg-[var(--bg-obsidian)] text-[var(--accent-coral)] font-semibold border-b-2 border-b-[var(--accent-coral)]'
                          : 'bg-[var(--bg-obsidian)] text-[var(--accent-mint)] font-semibold border-b-2 border-b-[var(--accent-mint)]'
                        : 'text-[var(--text-primary)] hover:bg-[var(--bg-control)] hover:text-[var(--accent-mint)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 py-1.5">
                {activeTab === 'log' && (
                  <div
                    className="flex border border-[var(--border-strong)] bg-[var(--bg-obsidian)]"
                    role="group"
                    aria-label="Telemetry Log Filter"
                  >
                    <button
                      type="button"
                      onClick={() => setLogFilter('all')}
                      aria-pressed={logFilter === 'all'}
                      className={`px-2.5 py-1 text-[11px] font-mono-tabular border-r border-[var(--border-grid)] cursor-pointer whitespace-nowrap ${
                        logFilter === 'all'
                          ? 'bg-[var(--accent-mint)] text-[var(--bg-obsidian)] font-semibold'
                          : 'bg-[var(--bg-control)] text-[var(--text-primary)] hover:text-[var(--accent-mint)]'
                      }`}
                    >
                      All ({logs.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setLogFilter('solar_storm')}
                      aria-pressed={logFilter === 'solar_storm'}
                      className={`px-2.5 py-1 text-[11px] font-mono-tabular cursor-pointer whitespace-nowrap ${
                        logFilter === 'solar_storm'
                          ? 'bg-[var(--accent-amber)] text-[var(--bg-obsidian)] font-semibold'
                          : 'bg-[var(--bg-control)] text-[var(--accent-amber)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      Solar Storms ({logs.filter((l) => l.category === 'solar_storm').length})
                    </button>
                  </div>
                )}
                {activeTab === 'audio-events' && (
                  <>
                    <span className="text-xs font-mono-tabular text-[var(--accent-amber)] font-semibold whitespace-nowrap hidden md:inline">
                      KP {solarTelemetry.kpIndex.toFixed(1)} · WIND {solarTelemetry.solarWindKms} KM/S
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleTriggerSolarTest()}
                      title="Test glitchy metallic auroral chime for high solar activity"
                      className="px-2.5 py-1 border border-[var(--accent-amber)] bg-[var(--bg-control)] text-[var(--accent-amber)] hover:bg-[var(--accent-amber)] hover:text-[var(--bg-obsidian)] text-[11px] font-mono-tabular font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Test Auroral Chime</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleTriggerSolarFlareTest()}
                      title="Test Solar Flare white-noise burst & sharp frequency sweep for extreme solar wind spikes"
                      className="px-2.5 py-1 border border-[var(--accent-coral)] bg-[var(--bg-control)] text-[var(--accent-coral)] hover:bg-[var(--accent-coral)] hover:text-[var(--bg-obsidian)] text-[11px] font-mono-tabular font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Test Solar Flare</span>
                    </button>
                    {audioEvents.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setAudioEvents([])}
                        className="px-2 py-1 border border-[var(--border-strong)] bg-[var(--bg-control)] text-[11px] font-mono-tabular text-[var(--text-primary)] hover:border-[var(--accent-coral)] hover:text-[var(--accent-coral)] cursor-pointer whitespace-nowrap"
                      >
                        Clear Events
                      </button>
                    )}
                  </>
                )}
                <span className="text-xs font-mono-tabular text-[var(--text-muted)] hidden sm:inline">
                  REV #{String(frameRevision).padStart(3, '0')}
                </span>
              </div>
            </div>

            <div className="p-3 bg-[var(--bg-obsidian)]">
              {activeTab === 'log' && (
                <div className="terminal-window h-44 overflow-y-auto font-mono-tabular text-xs leading-relaxed">
                  {(() => {
                    const visibleLogs =
                      logFilter === 'solar_storm'
                        ? logs.filter((entry) => entry.category === 'solar_storm')
                        : logs;
                    if (visibleLogs.length === 0) {
                      return (
                        <div className="h-full flex flex-col items-start justify-center gap-2 text-[var(--text-muted)]">
                          <span>
                            NO SOLAR STORM SURGES LOGGED YET · MONITORING AURORAL POTENTIAL (&ge;
                            {Math.round(AudioEngine.SOLAR_ACTIVITY_THRESHOLD * 100)}%, CURRENT{' '}
                            {solarTelemetry.auroralPotentialPct}% · KP {solarTelemetry.kpIndex.toFixed(1)}).
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleTriggerSolarTest()}
                            className="px-2.5 py-1 border border-[var(--accent-amber)] bg-[var(--bg-panel)] text-[var(--accent-amber)] hover:bg-[var(--accent-amber)] hover:text-[var(--bg-obsidian)] text-xs font-mono-tabular font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Simulate Solar Storm Surge</span>
                          </button>
                        </div>
                      );
                    }
                    return visibleLogs.map((entry) => {
                      const isSolarStorm = entry.category === 'solar_storm';
                      return (
                        <div
                          key={entry.id}
                          className={`flex flex-wrap gap-x-2 ${
                            isSolarStorm
                              ? 'border border-[var(--accent-amber)]/65 px-2 py-0.5 my-0.5 bg-[var(--bg-panel)]'
                              : 'py-0.5'
                          }`}
                        >
                          <span className="text-[var(--text-muted)] shrink-0">[{entry.timestamp}]</span>
                          {isSolarStorm && (
                            <span className="text-[var(--accent-amber)] font-bold shrink-0">
                              [SOLAR STORM]
                            </span>
                          )}
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
                      );
                    });
                  })()}
                </div>
              )}

              {activeTab === 'audio-events' && (
                <div className="terminal-window h-44 overflow-y-auto font-mono-tabular text-xs leading-relaxed">
                  {audioEvents.length === 0 ? (
                    <div className="h-full flex flex-col items-start justify-center gap-2 text-[var(--text-muted)]">
                      <span>
                        NO AUDIO EVENTS RECORDED YET · MONITORS SOLAR AURORA (&ge;
                        {Math.round(AudioEngine.SOLAR_ACTIVITY_THRESHOLD * 100)}%, NOW{' '}
                        {solarTelemetry.auroralPotentialPct}% / KP {solarTelemetry.kpIndex.toFixed(1)}),
                        2007 ANOMALIES (&ge;{Math.round(AudioEngine.ANOMALY_SPIKE_THRESHOLD * 100)}%),
                        &amp; MOTION (&ge;{Math.round(AudioEngine.HIGH_MOTION_THRESHOLD * 100)}%).
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleTriggerSolarTest()}
                          className="px-2.5 py-1 border border-[var(--accent-amber)] bg-[var(--bg-panel)] text-[var(--accent-amber)] hover:bg-[var(--accent-amber)] hover:text-[var(--bg-obsidian)] text-xs font-mono-tabular font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Trigger Solar Auroral Chime</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleTriggerSolarFlareTest()}
                          className="px-2.5 py-1 border border-[var(--accent-coral)] bg-[var(--bg-panel)] text-[var(--accent-coral)] hover:bg-[var(--accent-coral)] hover:text-[var(--bg-obsidian)] text-xs font-mono-tabular font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Trigger Solar Flare Burst</span>
                        </button>
                        {archiveYear !== 2007 && (
                          <button
                            type="button"
                            onClick={async () => {
                              await handleChangeYear(2007);
                              await handleScrubMonth(9);
                            }}
                            className="px-2.5 py-1 border border-[var(--accent-coral)] bg-[var(--bg-panel)] text-[var(--accent-coral)] hover:bg-[var(--accent-coral)] hover:text-[var(--bg-obsidian)] text-xs font-mono-tabular font-semibold cursor-pointer whitespace-nowrap"
                          >
                            Load 2007 Archive (Sep Minimum)
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    audioEvents.map((evt) => (
                      <div key={evt.id} className="flex flex-wrap gap-x-2 border-b border-[var(--border-grid)]/60 py-1">
                        <span className="text-[var(--text-muted)] shrink-0">[{evt.timestamp}]</span>
                        <span className="text-[var(--text-primary)] shrink-0">{evt.dateStr}</span>
                        <span
                          className={
                            evt.kind === 'solar_flare' || evt.kind === 'climate_anomaly_spike'
                              ? 'text-[var(--accent-coral)] font-semibold shrink-0'
                              : evt.kind === 'solar_activity'
                              ? 'text-[var(--accent-amber)] font-semibold shrink-0'
                              : 'text-[var(--accent-mint)] font-semibold shrink-0'
                          }
                        >
                          {evt.kind === 'solar_flare'
                            ? 'SOLAR FLARE'
                            : evt.kind === 'solar_activity'
                            ? 'AURORA CHIME'
                            : evt.kind === 'climate_anomaly_spike'
                            ? 'ANOMALY SPIKE'
                            : 'HIGH MOTION'}
                        </span>
                        <span className="text-[var(--text-primary)]">{evt.message}</span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === 'manual' && (
                <dl className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-5 gap-y-2 text-xs">
                  {(
                    [
                      ['Space / Enter', 'Play / Pause Sequencer'],
                      [
                        '← / →',
                        panningMode === 'smooth360'
                          ? 'Rotate 15° (Shift = 5°)'
                          : 'Snap 90° (Shift = 15°)',
                      ],
                      ['1 – 4', 'Jump N / E / S / W'],
                      ['H', 'Speak Telemetry Status'],
                      ['M', '3D Globe / EPSG:4326'],
                      ['V', 'Wind Flow Overlay'],
                      ['T', 'Solar Terminators'],
                      ['A', 'D3 Anomaly Heatmap'],
                      ['S', 'Storm Radar Isobars'],
                      ['R', 'Vacuum / Atmos Reverb'],
                      ['P', '360° / Cardinal Pan'],
                      ['O', 'Auto-Rotate Scan'],
                      ['G', 'Magnetic Anomaly Snap'],
                      ['W', 'Atmos Flow Wind'],
                      ['N', 'Observatory Night Mode'],
                    ] as Array<[string, string]>
                  ).map(([shortcut, desc]) => (
                    <div
                      key={shortcut}
                      className="flex items-center justify-between gap-2 border-b border-[var(--border-grid)] pb-1.5"
                    >
                      <dt className="font-mono-tabular shrink-0">
                        <kbd className="border border-[var(--border-strong)] bg-[var(--bg-control)] px-1.5 py-0.5 text-[var(--accent-mint)] font-semibold">
                          {shortcut}
                        </kbd>
                      </dt>
                      <dd className="text-[var(--text-primary)] truncate text-right">{desc}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {activeTab === 'specs' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse font-mono-tabular text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border-strong)] text-[var(--text-muted)]">
                        <th className="py-1.5 pr-3">HEADING</th>
                        <th className="py-1.5 pr-3">PHENOMENON</th>
                        <th className="py-1.5 pr-3">NASA GIBS LAYER</th>
                        <th className="py-1.5 pr-3">WAVE</th>
                        <th className="py-1.5">3D COORDS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {LAYER_ORDER.map((key) => {
                        const m = NASA_GIBS_LAYERS[key];
                        return (
                          <tr
                            key={key}
                            className={`border-b border-[var(--border-grid)] ${
                              key === activeLayerKey ? 'text-[var(--accent-mint)] font-semibold' : 'text-[var(--text-primary)]'
                            }`}
                          >
                            <td className="py-1.5 pr-3 whitespace-nowrap">
                              {m.azimuthLabel} {m.cardinal}
                            </td>
                            <td className="py-1.5 pr-3">{m.phenomenon}</td>
                            <td className="py-1.5 pr-3">{m.gibsLayerId}</td>
                            <td className="py-1.5 pr-3 uppercase">{m.waveform}</td>
                            <td className="py-1.5 whitespace-nowrap">
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
          className="p-3 lg:p-4 flex flex-col gap-3.5 bg-[var(--bg-console)] min-w-0"
        >
          <AudioSpectrumBar
            analyser={audioEngineRef.current?.getAnalyserNode() ?? null}
            isPlaying={isPlaying}
            isTestingSpatial={isTestingSpatial}
            nightMode={observatoryNightMode}
            theme={activeTheme}
          />

          <RadarCompassHud
            listenerAngle={listenerAngle}
            activeLayerKey={activeLayerKey}
            vectors={vectors}
            panningMode={panningMode}
            autoRotate={autoRotateEnabled}
            magneticSnap={magneticSnapEnabled}
            windTelemetry={headingWind}
            atmosphericFlowEnabled={atmosphericFlowEnabled}
            nightMode={observatoryNightMode}
            theme={activeTheme}
            auroralPulse={auroralPulse}
            solarFlare={solarFlareSignal}
            onChangeHeading={(deg) => handleSetHeading(deg)}
            onSelectLayer={handleSelectLayer}
            onChangePanningMode={handlePanningModeChange}
            onToggleAutoRotate={handleToggleAutoRotate}
            onToggleMagneticSnap={handleToggleMagneticSnap}
          />

          <section
            aria-label="6-Signal Feature Vector Matrix"
            className="border border-[var(--border-strong)] bg-[var(--bg-console)] flex flex-col"
          >
            <div className="flex items-center justify-between gap-2 px-3 h-[38px] border-b border-[var(--border-grid)] bg-[var(--bg-panel)]">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] truncate min-w-0">
                6-Signal Acoustic Vector
              </h2>
              <div className="flex items-center gap-2 text-xs font-mono-tabular whitespace-nowrap shrink-0">
                <span className="text-[var(--accent-mint)] font-semibold">
                  {activeLayer.cardinal.toUpperCase()} · {activePitchHz.toFixed(0)} HZ
                </span>
                <span
                  className={`inline-flex items-center justify-end gap-0.5 font-semibold min-w-[56px] ${
                    activeDoppler.direction === 'up'
                      ? 'text-[var(--accent-mint)]'
                      : activeDoppler.direction === 'down'
                      ? 'text-[var(--accent-coral)]'
                      : 'text-[var(--text-muted)]'
                  }`}
                  aria-label={`Active Doppler pitch shift ${
                    activeDoppler.direction === 'up'
                      ? 'up'
                      : activeDoppler.direction === 'down'
                      ? 'down'
                      : 'flat'
                  } ${formatSignedDopplerPct(activeDoppler.shiftPct)}`}
                >
                  {activeDoppler.direction === 'up' ? (
                    <ArrowUp className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  ) : activeDoppler.direction === 'down' ? (
                    <ArrowDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <Minus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span>{formatSignedDopplerPct(activeDoppler.shiftPct)}</span>
                </span>
              </div>
            </div>

            <div
              className="px-3 pt-2.5 pb-2.5 bg-[var(--bg-obsidian)] border-b border-[var(--border-grid)]"
              role="group"
              aria-label="Per-layer real-time Doppler frequency shifts"
            >
              <div className="flex items-center justify-between gap-2 h-[18px] text-[11px] font-mono-tabular uppercase tracking-wider text-[var(--text-muted)] mb-2 whitespace-nowrap min-w-0">
                <span className="text-[var(--text-primary)] font-semibold truncate">
                  Layer Doppler Shift (N · E · S · W)
                </span>
                <span className="shrink-0">{cadenceMs} ms frame rate</span>
              </div>
              <div className="grid grid-cols-2 auto-rows-fr gap-2">
                {LAYER_ORDER.map((key) => {
                  const meta = NASA_GIBS_LAYERS[key];
                  const d = dopplerByLayer[key];
                  const hz = Math.round(frequencies[key] ?? 0);
                  const isActive = key === activeLayerKey;
                  const scaleCeiling = Math.max(14.3, 14.3 * Math.max(1, dopplerSensitivity));
                  const magPct = Math.min(100, Math.round((Math.abs(d.shiftPct) / scaleCeiling) * 100));
                  const dirColorClass =
                    d.direction === 'up'
                      ? 'text-[var(--accent-mint)]'
                      : d.direction === 'down'
                      ? 'text-[var(--accent-coral)]'
                      : 'text-[var(--text-muted)]';
                  const barColorClass =
                    d.direction === 'up'
                      ? 'bg-[var(--accent-mint)]'
                      : d.direction === 'down'
                      ? 'bg-[var(--accent-coral)]'
                      : 'bg-[var(--text-muted)]';
                  const dirText =
                    d.direction === 'up'
                      ? 'shifting pitch up'
                      : d.direction === 'down'
                      ? 'shifting pitch down'
                      : 'neutral pitch';

                  return (
                    <div
                      key={key}
                      className={`min-w-0 overflow-hidden border px-2.5 py-2 font-mono-tabular flex flex-col justify-between ${
                        isActive
                          ? 'border-[var(--accent-mint)] bg-[var(--bg-panel)]'
                          : 'border-[var(--border-strong)] bg-[var(--bg-control)]'
                      }`}
                      aria-label={`${meta.cardinal} ${meta.domain} frequency ${hz} Hz, Doppler ${dirText} ${formatSignedDopplerPct(
                        d.shiftPct
                      )}`}
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_58px] items-center gap-1.5 h-[18px] text-[11px] whitespace-nowrap">
                        <span className="font-semibold text-[var(--text-primary)] truncate">
                          {meta.shortCardinal} · {hz} Hz
                        </span>
                        <span
                          className={`w-[58px] inline-flex items-center justify-end gap-0.5 font-semibold tabular-nums whitespace-nowrap ${dirColorClass}`}
                        >
                          {d.direction === 'up' ? (
                            <ArrowUp className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                          ) : d.direction === 'down' ? (
                            <ArrowDown className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                          ) : (
                            <Minus className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                          )}
                          <span>{formatSignedDopplerPct(d.shiftPct)}</span>
                        </span>
                      </div>
                      <div
                        className="mt-1.5 h-1.5 w-full bg-[var(--bg-obsidian)] border border-[var(--border-grid)]"
                        role="progressbar"
                        aria-label={`${meta.cardinal} Doppler shift magnitude`}
                        aria-valuenow={magPct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className={`h-full transition-[width,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${barColorClass}`}
                          style={{ width: `${magPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-2.5 pt-2.5 border-t border-[var(--border-grid)]">
                <div className="grid grid-cols-[minmax(0,1fr)_124px] items-center gap-2 h-[18px] text-[11px] font-mono-tabular mb-1.5 whitespace-nowrap">
                  <label
                    htmlFor="dopplerSensitivitySlider"
                    className="uppercase tracking-wider text-[var(--text-primary)] font-semibold truncate"
                  >
                    Doppler Sensitivity
                  </label>
                  <span
                    className={`w-[124px] font-semibold text-right tabular-nums ${
                      dopplerSensitivity === 0
                        ? 'text-[var(--text-muted)]'
                        : dopplerSensitivity > 1.5
                        ? 'text-[var(--accent-amber)]'
                        : 'text-[var(--accent-mint)]'
                    }`}
                  >
                    {dopplerSensitivity.toFixed(2)}× ·{' '}
                    {dopplerSensitivity === 0
                      ? 'BYPASS'
                      : dopplerSensitivity < 0.65
                      ? 'SUBTLE'
                      : dopplerSensitivity <= 1.45
                      ? 'NOMINAL'
                      : 'GLISSANDO'}
                  </span>
                </div>
                <input
                  id="dopplerSensitivitySlider"
                  type="range"
                  min={0}
                  max={3.0}
                  step={0.05}
                  value={dopplerSensitivity}
                  onChange={(e) => handleDopplerSensitivityChange(parseFloat(e.target.value))}
                  className="scientific-slider block"
                  aria-label="Doppler sensitivity pitch shift multiplier"
                />
              </div>
            </div>

            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 auto-rows-fr gap-2 bg-[var(--bg-obsidian)]">
              {signalRows.map((row) => {
                const pct = Math.round(row.value * 100);
                const rowDoppler = row.doppler;
                return (
                  <div
                    key={row.label}
                    className="min-w-0 min-h-[78px] overflow-hidden border border-[var(--border-strong)] bg-[var(--bg-console)] p-2.5 flex flex-col justify-between"
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_52px] items-center gap-2 h-[18px] text-xs font-mono-tabular whitespace-nowrap">
                      <span className="text-[var(--text-primary)] font-medium truncate">
                        {row.label}
                      </span>
                      <span
                        className={`w-[52px] text-right tabular-nums whitespace-nowrap ${
                          row.isCoral
                            ? 'text-[var(--accent-coral)] font-semibold'
                            : 'text-[var(--accent-mint)] font-semibold'
                        }`}
                      >
                        {row.value.toFixed(3)}
                      </span>
                    </div>
                    <div
                      className="mt-1.5 h-2 w-full bg-[var(--bg-obsidian)] border border-[var(--border-grid)]"
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
                    <div className="mt-1.5 h-[18px] grid grid-cols-[minmax(0,1fr)_36px] items-center gap-1.5 text-[11px] font-mono-tabular text-[var(--text-muted)] whitespace-nowrap">
                      <span className="truncate" title={row.target}>
                        {row.target}
                      </span>
                      <div className="w-[36px] flex items-center justify-end">
                        {rowDoppler ? (
                          <span
                            className={`inline-flex items-center justify-end gap-0.5 font-semibold whitespace-nowrap tabular-nums ${
                              rowDoppler.direction === 'up'
                                ? 'text-[var(--accent-mint)]'
                                : rowDoppler.direction === 'down'
                                ? 'text-[var(--accent-coral)]'
                                : 'text-[var(--text-muted)]'
                            }`}
                            aria-label={`${row.label} Doppler direction ${
                              rowDoppler.direction === 'up'
                                ? 'upward'
                                : rowDoppler.direction === 'down'
                                ? 'downward'
                                : 'neutral'
                            }`}
                          >
                            {rowDoppler.direction === 'up' ? (
                              <ArrowUp className="w-3 h-3 shrink-0" aria-hidden="true" />
                            ) : rowDoppler.direction === 'down' ? (
                              <ArrowDown className="w-3 h-3 shrink-0" aria-hidden="true" />
                            ) : (
                              <Minus className="w-3 h-3 shrink-0" aria-hidden="true" />
                            )}
                            <span>
                              {rowDoppler.direction === 'up'
                                ? 'UP'
                                : rowDoppler.direction === 'down'
                                ? 'DN'
                                : '0%'}
                            </span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-3 pb-3 pt-2.5 border-t border-[var(--border-grid)] bg-[var(--bg-obsidian)] flex flex-col gap-2.5">
              <div className="grid grid-cols-[minmax(0,1fr)_96px] items-center gap-2">
                <TactileSwitchToggle
                  checked={showSignalCorrelation}
                  onToggle={handleToggleSignalCorrelation}
                  label="Signal Correlation"
                  accent="mint"
                  compact
                  icon={<ScatterChart className="w-3.5 h-3.5" />}
                  title="Toggle real-time D3 Pearson correlation scatter plot between Brightness and Climate Anomaly telemetry"
                />
                <span
                  className={`text-right text-[11px] font-mono-tabular font-semibold tabular-nums whitespace-nowrap ${
                    correlationStats.polarity === 'positive'
                      ? 'text-[var(--accent-mint)]'
                      : correlationStats.polarity === 'negative'
                      ? 'text-[var(--accent-coral)]'
                      : 'text-[var(--text-muted)]'
                  }`}
                >
                  r = {correlationStats.r >= 0 ? '+' : ''}
                  {correlationStats.r.toFixed(3)}
                </span>
              </div>

              {showSignalCorrelation && (
                <SignalCorrelationPlot
                  points={correlationPoints}
                  stats={correlationStats}
                  activeLayerKey={activeLayerKey}
                  nightMode={observatoryNightMode}
                  theme={activeTheme}
                />
              )}
            </div>
          </section>

          <TemporalTrendsChart
            history={history}
            archiveYear={archiveYear}
            maxMonths={maxMonth}
            nightMode={observatoryNightMode}
            theme={activeTheme}
          />
        </aside>
      </main>

      <footer
        role="contentinfo"
        className="border-t border-[var(--border-grid)] bg-[var(--bg-console)]"
      >
        <div className="max-w-[1680px] mx-auto w-full px-4 lg:px-5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono-tabular text-[var(--text-muted)]">
          <span>ORTHOGRAPHIC 3D + EPSG:4326 · WEB AUDIO HRTF BINAURAL ENGINE</span>
          <span>LIVE NASA GIBS 2025–2026 &amp; 2007 ARCHIVE · WCAG AAA KEYBOARD ACCESSIBLE</span>
        </div>
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
        theme={activeTheme}
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
