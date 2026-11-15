/**
 * Accessible Screen-Reader & Optional Web Speech API Announcer
 * - Debounced 180ms delivery for rapid keyboard navigation
 * - Repeat-cue forcing via requestAnimationFrame clearing & re-insertion
 * - Optional Web Speech API synthesis toggle
 */
export class AccessibilityAnnouncer {
  private liveElement: HTMLElement | null = null;
  private debounceTimer: number | null = null;
  private speechEnabled = false;

  public attachElement(el: HTMLElement | null): void {
    this.liveElement = el;
  }

  public setSpeechEnabled(enabled: boolean): void {
    this.speechEnabled = enabled;
    if (!enabled && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
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

    if (this.speechEnabled && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.rate = 1.08;
        utterance.pitch = 1.0;
        window.speechSynthesis.speak(utterance);
      } catch {
        // Ignore speech synthesis errors in restricted environments
      }
    }
  }

  public dispose(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }
}
