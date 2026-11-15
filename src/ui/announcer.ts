/**
 * Accessible Screen-Reader & Optional Web Speech API Announcer
 * - Debounced 180ms delivery for rapid keyboard navigation
 * - Repeat-cue forcing via requestAnimationFrame clearing & re-insertion
 * - Safe Web Speech API scheduling (prevents cancel/speak buffer glitches & trailing chirps)
 * - Emits speech active state callbacks so Web Audio synthesis can duck cleanly
 */
const EXCLUDED_VOICE_PATTERN =
  /espeak|bells|bubbles|trinoids|boing|cellos|zarvox|whisper|organ|jester|albert|junior|princess|superstar|good news|bad news|ralph|kathy|fred|hysterical|deranged|bahh|wobble|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley/i;

const PREFERRED_LOCAL_VOICE_PATTERN =
  /samantha|alex|daniel|karen|moira|tessa|serena|ava|allison|susan|zoe|nora|aria|jenny|guy|david|zira|mark|natural|enhanced|premium/i;

function normalizeForSpeech(text: string): string {
  const cleaned = text
    .replace(/°/g, ' degrees')
    .replace(/[·•|]/g, ', ')
    .replace(/→|->/g, ' to ')
    .replace(/×/g, ' times ')
    .replace(/ΔT/g, 'temperature anomaly')
    .replace(/%/g, ' percent')
    .replace(/\bHZ\b/gi, ' hertz')
    .replace(/\bMS\b/gi, ' milliseconds')
    .replace(/\s+/g, ' ')
    .replace(/,\s*,+/g, ',')
    .trim();

  if (!cleaned) return '';
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function selectPreferredVoice(cachedVoices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const liveVoices = window.speechSynthesis.getVoices();
  const voices = liveVoices && liveVoices.length > 0 ? liveVoices : cachedVoices;
  if (!voices || voices.length === 0) return null;

  const usable = voices.filter((v) => !EXCLUDED_VOICE_PATTERN.test(v.name));
  const pool = usable.length > 0 ? usable : voices;
  const enPool = pool.filter((v) => v.lang.toLowerCase().startsWith('en'));

  // Strictly prefer local OS voices without Google cloud streaming MP3-tail glitches
  const localEn = enPool.filter((v) => v.localService && !/^google\b/i.test(v.name));

  return (
    localEn.find((v) => PREFERRED_LOCAL_VOICE_PATTERN.test(v.name)) ||
    localEn.find((v) => v.default) ||
    localEn[0] ||
    enPool.find((v) => PREFERRED_LOCAL_VOICE_PATTERN.test(v.name) && !/^google\b/i.test(v.name)) ||
    enPool.find((v) => !/^google\b/i.test(v.name)) ||
    enPool[0] ||
    pool[0] ||
    null
  );
}

export interface AudioOutputTarget {
  context: AudioContext | null;
  gainNode: GainNode | null;
}

export class AccessibilityAnnouncer {
  private static readonly POST_SPEECH_DECAY_SEC = 0.1;

  private liveElement: HTMLElement | null = null;
  private debounceTimer: number | null = null;
  private speakDelayTimer: number | null = null;
  private safetyEndTimer: number | null = null;
  private speechEnabled = false;
  private isSpeaking = false;
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private cachedVoices: SpeechSynthesisVoice[] = [];
  private speechStateListener: ((speaking: boolean, recoveryDelaySec?: number) => void) | null = null;
  private audioOutputProvider: (() => AudioOutputTarget | null) | null = null;

  private readonly handleVoicesChanged = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.cachedVoices = window.speechSynthesis.getVoices();
    }
  };

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.cachedVoices = window.speechSynthesis.getVoices();
      window.speechSynthesis.addEventListener?.('voiceschanged', this.handleVoicesChanged);
    }
  }

  public attachElement(el: HTMLElement | null): void {
    this.liveElement = el;
  }

  public attachAudioOutput(provider: (() => AudioOutputTarget | null) | null): void {
    this.audioOutputProvider = provider;
  }

  public setSpeechStateListener(
    listener: ((speaking: boolean, recoveryDelaySec?: number) => void) | null
  ): void {
    this.speechStateListener = listener;
  }

  private applyPostSpeechDecayRamp(durationSec = AccessibilityAnnouncer.POST_SPEECH_DECAY_SEC): void {
    const target = this.audioOutputProvider?.();
    const ctx = target?.context;
    const gainNode = target?.gainNode;
    if (!ctx || !gainNode || ctx.state === 'closed') return;

    const now = ctx.currentTime;
    const gainParam = gainNode.gain;
    const safeStart = Math.max(0.0001, gainParam.value);

    if (typeof gainParam.cancelAndHoldAtTime === 'function') {
      gainParam.cancelAndHoldAtTime(now);
    } else {
      gainParam.cancelScheduledValues(now);
    }

    gainParam.setValueAtTime(safeStart, now);
    gainParam.exponentialRampToValueAtTime(0.0001, now + Math.max(0.01, durationSec));
  }

  private updateSpeakingState(speaking: boolean, recoveryDelaySec = 0): void {
    if (this.safetyEndTimer !== null) {
      window.clearTimeout(this.safetyEndTimer);
      this.safetyEndTimer = null;
    }
    if (this.isSpeaking === speaking) return;
    this.isSpeaking = speaking;
    this.speechStateListener?.(speaking, recoveryDelaySec);
  }

  private stopCurrentSpeech(): void {
    if (this.speakDelayTimer !== null) {
      window.clearTimeout(this.speakDelayTimer);
      this.speakDelayTimer = null;
    }
    if (this.activeUtterance) {
      this.activeUtterance.onstart = null;
      this.activeUtterance.onend = null;
      this.activeUtterance.onerror = null;
      this.activeUtterance = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
          window.speechSynthesis.cancel();
        }
      } catch {
        // Ignore speech synthesis cancel errors
      }
    }
    this.updateSpeakingState(false);
  }

  public setSpeechEnabled(enabled: boolean): void {
    this.speechEnabled = enabled;
    if (!enabled) {
      this.stopCurrentSpeech();
    } else if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.cachedVoices = window.speechSynthesis.getVoices();
    }
  }

  public isSpeechEnabled(): boolean {
    return this.speechEnabled;
  }

  public announce(message: string): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.executeAnnouncement(message);
    }, 180);
  }

  public announceImmediate(message: string): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.executeAnnouncement(message);
  }

  private executeAnnouncement(message: string): void {
    if (this.liveElement) {
      this.liveElement.textContent = '';
      window.requestAnimationFrame(() => {
        if (this.liveElement) {
          this.liveElement.textContent = message;
        }
      });
    }

    if (!this.speechEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    const spokenText = normalizeForSpeech(message);
    if (!spokenText) return;

    const synth = window.speechSynthesis;
    const wasBusy = synth.speaking || synth.pending || this.activeUtterance !== null;
    this.stopCurrentSpeech();

    const startUtterance = () => {
      if (!this.speechEnabled) return;
      try {
        const utterance = new SpeechSynthesisUtterance(spokenText);
        const preferredVoice = selectPreferredVoice(this.cachedVoices);
        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }
        // Keep native rate=1.0, pitch=1.0, volume=1.0 so TTS engines bypass DSP resamplers
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        utterance.onstart = () => {
          if (this.activeUtterance !== utterance) return;
          this.updateSpeakingState(true);
          this.safetyEndTimer = window.setTimeout(() => {
            if (this.activeUtterance === utterance) {
              this.activeUtterance = null;
              this.applyPostSpeechDecayRamp(AccessibilityAnnouncer.POST_SPEECH_DECAY_SEC);
              this.updateSpeakingState(false, AccessibilityAnnouncer.POST_SPEECH_DECAY_SEC + 0.01);
            }
          }, Math.max(4000, spokenText.length * 110));
        };

        const handleFinish = () => {
          if (this.activeUtterance === utterance) {
            this.activeUtterance = null;
            this.applyPostSpeechDecayRamp(AccessibilityAnnouncer.POST_SPEECH_DECAY_SEC);
            this.updateSpeakingState(false, AccessibilityAnnouncer.POST_SPEECH_DECAY_SEC + 0.01);
          }
        };

        utterance.onend = handleFinish;
        utterance.onerror = handleFinish;

        this.activeUtterance = utterance;
        synth.speak(utterance);
      } catch {
        this.activeUtterance = null;
        this.updateSpeakingState(false);
      }
    };

    const voicesReady =
      (synth.getVoices()?.length ?? 0) > 0 || this.cachedVoices.length > 0;
    const delayMs = wasBusy ? 90 : !voicesReady ? 220 : 0;

    if (delayMs > 0) {
      this.speakDelayTimer = window.setTimeout(() => {
        this.speakDelayTimer = null;
        this.cachedVoices = synth.getVoices();
        startUtterance();
      }, delayMs);
    } else {
      startUtterance();
    }
  }

  public dispose(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.removeEventListener?.('voiceschanged', this.handleVoicesChanged);
    }
    this.stopCurrentSpeech();
    this.speechStateListener = null;
    this.audioOutputProvider = null;
  }
}
