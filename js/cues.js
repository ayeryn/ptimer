// cues.js — Voice (SpeechSynthesis) + Web Audio beeps, both gated by settings.
//
// Must be unlocked by a user gesture before use (call unlock() on Start tap).
// Each channel (voice, beeps) is independently togglable.

export class CueEngine {
  constructor(settings) {
    this._settings    = settings;
    this._audioCtx    = null;
    this._unlocked    = false;
    this._speechQueue = [];
    this._speaking    = false;
  }

  // ── Unlock (call on first user gesture / Start tap) ───────────────────────

  unlock() {
    if (this._unlocked) return;
    try {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      // Play a silent buffer to unlock audio on iOS
      const buf = this._audioCtx.createBuffer(1, 1, 22050);
      const src = this._audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(this._audioCtx.destination);
      src.start(0);
    } catch (e) {
      console.warn('CueEngine: could not create AudioContext', e);
    }

    // Prime speech synthesis on iOS (first utterance often silent)
    if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }

    this._unlocked = true;
  }

  updateSettings(settings) {
    this._settings = settings;
  }

  // ── Phase cues ────────────────────────────────────────────────────────────

  /**
   * Called on every onPhaseStart event.
   * Fires voice announcement + a beep.
   */
  onPhaseStart(phase) {
    const { type, label, exerciseName, setIdx, exerciseIdx } = phase;

    switch (type) {
      case 'get-ready':
        this._speak(`${exerciseName}. Get ready.`);
        this._beep('ready');
        break;

      case 'rep:out':
        if (phase.repIdx === 0) {
          // First rep of a set — announce the set
          this._speak(`Set ${setIdx + 1}. Out.`);
        } else {
          this._speak('Out.');
        }
        this._beep('phase');
        break;

      case 'rep:hold':
        this._speak('Hold.');
        this._beep('phase-soft');
        break;

      case 'rep:return':
        this._speak('Return.');
        this._beep('phase');
        break;

      case 'hold':
        this._speak(`Set ${setIdx + 1}. Hold.`);
        this._beep('ready');
        break;

      case 'rest': {
        const restLabel = label === 'NEXT EXERCISE' ? `Next: ${phase.subLabel}.` : 'Rest.';
        this._speak(restLabel);
        this._beep('rest');
        break;
      }

      case 'done':
        this._speak('Done. Great work!');
        this._beep('done');
        break;
    }
  }

  /**
   * Called on every onTick when the phase is 'rest' or 'get-ready' to count
   * down the last 3 seconds aloud.
   */
  onTick(remaining, phase) {
    if (!['rest', 'get-ready', 'hold'].includes(phase.type)) return;
    const secs = Math.round(remaining);
    if (secs <= 3 && secs >= 1) {
      this._speakCount(secs);
    }
  }

  // ── Rep count announcement ─────────────────────────────────────────────────

  announceRep(repNum) {
    // Called by app.js at the start of each rep:out
    this._speak(String(repNum), true /* interrupt */);
  }

  // ── Voice ─────────────────────────────────────────────────────────────────

  _speak(text, interrupt = false) {
    if (!this._settings.voice) return;
    if (!window.speechSynthesis) return;

    if (interrupt) {
      window.speechSynthesis.cancel();
      this._speechQueue = [];
      this._speaking    = false;
    }

    this._speechQueue.push(text);
    if (!this._speaking) this._flushSpeech();
  }

  _flushSpeech() {
    if (!this._speechQueue.length) { this._speaking = false; return; }
    this._speaking = true;
    const text = this._speechQueue.shift();
    const u    = new SpeechSynthesisUtterance(text);
    u.rate      = this._settings.voiceRate ?? 1.0;
    u.pitch     = 1.0;
    u.volume    = 1.0;
    u.onend     = () => this._flushSpeech();
    u.onerror   = () => this._flushSpeech();
    window.speechSynthesis.speak(u);
  }

  // Countdown words (separate queue slot so they don't interrupt mid-word)
  _speakCount(n) {
    const words = ['', 'one', 'two', 'three', 'four', 'five'];
    const word  = words[n] ?? String(n);
    // Only enqueue if not already queued (avoid duplicates from fast ticks)
    if (!this._speechQueue.includes(word)) {
      this._speak(word);
    }
  }

  // ── Web Audio beeps ───────────────────────────────────────────────────────

  _beep(kind) {
    if (!this._settings.beeps) return;
    if (!this._audioCtx) return;

    const configs = {
      // kind:      [freq, gainPeak, duration]
      ready:      [660,  0.3, 0.12],
      phase:      [880,  0.25, 0.08],
      'phase-soft': [660, 0.15, 0.06],
      rest:       [440,  0.3, 0.15],
      done:       [880,  0.4, 0.08],  // will play a quick ascending pair
    };

    const cfg = configs[kind] ?? configs.phase;
    this._playTone(...cfg);

    if (kind === 'done') {
      // Ascending pair: low then high
      setTimeout(() => this._playTone(1100, 0.4, 0.12), 100);
    }
  }

  _playTone(freq, gain, dur) {
    if (!this._audioCtx) return;
    try {
      const osc   = this._audioCtx.createOscillator();
      const gainN = this._audioCtx.createGain();
      osc.connect(gainN);
      gainN.connect(this._audioCtx.destination);
      osc.type      = 'sine';
      osc.frequency.value = freq;
      gainN.gain.setValueAtTime(gain, this._audioCtx.currentTime);
      gainN.gain.exponentialRampToValueAtTime(0.001, this._audioCtx.currentTime + dur);
      osc.start(this._audioCtx.currentTime);
      osc.stop(this._audioCtx.currentTime + dur + 0.01);
    } catch (e) {
      // Silently ignore (context may be suspended)
    }
  }
}
