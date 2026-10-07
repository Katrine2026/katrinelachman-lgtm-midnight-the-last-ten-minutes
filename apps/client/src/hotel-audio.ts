/** Original, local-only Web Audio cues for the Meridian. */
export class HotelAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private roomTone: GainNode | null = null;
  private airFilter: BiquadFilterNode | null = null;
  private ambientSources: AudioScheduledSourceNode[] = [];
  private ambientTimer = 0;
  private muted = this.readMutedPreference();
  private ambienceStarted = false;
  private lastFootstepAt = 0;
  private footstepCount = 0;
  private pressureBand = 0;
  private lastCountdownTick = -1;

  get isMuted(): boolean { return this.muted; }

  /** Call synchronously from a user gesture so the browser can unlock Web Audio. */
  unlockFromGesture(): void {
    if (this.muted) return;
    const context = this.getContext();
    if (!context) return;
    if (context.state !== "running") void context.resume().catch(() => undefined);
    this.setMasterLevel(0.42);
    this.startAmbience();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try { localStorage.setItem("midnight-audio-muted", String(muted)); } catch {
      // Audio preferences are optional when storage is unavailable.
    }
    if (muted) this.setMasterLevel(0);
  }

  stopAmbience(): void {
    if (this.ambientTimer) window.clearTimeout(this.ambientTimer);
    this.ambientTimer = 0;
    if (!this.roomTone || !this.context) return;
    const sources = this.ambientSources;
    const tone = this.roomTone;
    this.ambientSources = [];
    this.ambienceStarted = false;
    this.roomTone = null;
    this.airFilter = null;
    const now = this.context.currentTime;
    tone.gain.cancelScheduledValues(now);
    tone.gain.setTargetAtTime(0, now, 0.08);
    window.setTimeout(() => {
      for (const source of sources) {
        try { source.stop(); } catch { /* The source may already have ended. */ }
        source.disconnect();
      }
      tone.disconnect();
    }, 420);
  }

  playFootstep(): void {
    if (!this.canPlay() || performance.now() - this.lastFootstepAt < 285) return;
    this.lastFootstepAt = performance.now();
    const side = this.footstepCount++ % 2;
    this.playNoiseBurst(0.075, side ? 155 : 190, 0.045);
    this.playTone(side ? 82 : 76, 0.095, "sine", 0.055, 0, side ? 54 : 48);
  }

  playClueFound(): void {
    this.playTone(622, 0.19, "sine", 0.055);
    this.playTone(831, 0.25, "triangle", 0.045, 0.075);
    this.playNoiseBurst(0.055, 780, 0.018);
  }

  playKeyFound(): void {
    this.playNoiseBurst(0.11, 1250, 0.035);
    this.playTone(196, 0.58, "triangle", 0.09, 0.015, 142);
    this.playTone(392, 0.49, "sine", 0.055, 0.025, 310);
    this.playTone(587, 0.42, "sine", 0.028, 0.04, 460);
  }

  playExitUnlocked(): void {
    this.playNoiseBurst(0.14, 520, 0.05);
    this.playTone(147, 0.72, "triangle", 0.105, 0.03, 73);
    this.playTone(294, 0.46, "sine", 0.045, 0.12, 220);
  }

  playEscape(): void {
    this.playTone(392, 0.56, "sine", 0.045);
    this.playTone(523, 0.62, "triangle", 0.04, 0.055);
    this.playTone(659, 0.7, "sine", 0.035, 0.11);
  }

  playWin(): void {
    this.playTone(330, 0.76, "sine", 0.04);
    this.playTone(440, 0.82, "triangle", 0.04, 0.08);
    this.playTone(554, 0.9, "sine", 0.035, 0.15);
  }

  playTimeout(): void {
    this.playNoiseBurst(0.12, 420, 0.045);
    this.playTone(262, 0.96, "triangle", 0.1, 0, 88);
    this.playTone(131, 1.12, "sine", 0.075, 0.08, 55);
  }

  playElevatorClose(): void {
    this.playNoiseBurst(0.16, 240, 0.045);
    this.playTone(110, 0.8, "triangle", 0.07, 0.02, 62);
    this.playTone(220, 0.56, "sine", 0.025, 0.09, 164);
  }

  setCountdownPressure(secondsRemaining: number): void {
    const band = secondsRemaining <= 10 ? 3 : secondsRemaining <= 60 ? 2 : secondsRemaining <= 120 ? 1 : 0;
    if (band !== this.pressureBand) {
      this.pressureBand = band;
      if (this.context && this.airFilter) {
        const frequencies = [720, 560, 390, 280];
        this.airFilter.frequency.setTargetAtTime(frequencies[band], this.context.currentTime, 1.8);
      }
    }
    const second = Math.ceil(secondsRemaining);
    if (band === 3 && second > 0 && second <= 10 && second !== this.lastCountdownTick) {
      this.lastCountdownTick = second;
      this.playTone(second <= 3 ? 880 : 660, 0.075, "sine", 0.024);
    }
    if (band !== 3) this.lastCountdownTick = -1;
  }

  private readMutedPreference(): boolean {
    try { return localStorage.getItem("midnight-audio-muted") === "true"; } catch { return false; }
  }

  private getContext(): AudioContext | null {
    if (this.context) return this.context;
    if (!window.AudioContext) return null;
    try {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.context.destination);
      return this.context;
    } catch {
      this.context = null;
      this.master = null;
      return null;
    }
  }

  private setMasterLevel(level: number): void {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(level, now, 0.045);
  }

  private startAmbience(): void {
    if (!this.context || !this.master || this.ambienceStarted || this.muted) return;
    const context = this.context;
    this.ambienceStarted = true;
    const tone = context.createGain();
    tone.gain.value = 0.3;
    tone.connect(this.master);
    this.roomTone = tone;
    const lowPass = context.createBiquadFilter();
    lowPass.type = "lowpass";
    lowPass.frequency.value = 140;
    lowPass.Q.value = 0.45;
    lowPass.connect(tone);
    for (const [frequency, volume] of [[49.2, 0.09], [50.1, 0.065], [73.4, 0.018]] as const) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.value = volume;
      oscillator.connect(gain);
      gain.connect(lowPass);
      oscillator.start();
      this.ambientSources.push(oscillator);
    }
    const airFilter = context.createBiquadFilter();
    airFilter.type = "lowpass";
    airFilter.frequency.value = 720;
    airFilter.Q.value = 0.35;
    this.airFilter = airFilter;
    const noise = context.createBufferSource();
    const noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const noiseGain = context.createGain();
    noiseGain.gain.value = 0.009;
    noise.connect(airFilter);
    airFilter.connect(noiseGain);
    noiseGain.connect(tone);
    noise.start();
    this.ambientSources.push(noise);
    this.scheduleDistantPipe();
  }

  private scheduleDistantPipe(): void {
    if (this.muted || !this.ambienceStarted) return;
    this.ambientTimer = window.setTimeout(() => {
      if (!this.muted && this.context?.state === "running") this.playTone(185, 0.72, "triangle", 0.018, 0, 138);
      this.scheduleDistantPipe();
    }, 13000 + Math.random() * 15000);
  }

  private canPlay(): boolean {
    return Boolean(this.context && this.master && this.context.state === "running" && !this.muted);
  }

  private playTone(frequency: number, duration: number, waveform: OscillatorType, volume: number, offset = 0, endFrequency?: number): void {
    if (!this.canPlay() || !this.context || !this.master) return;
    const context = this.context;
    const startAt = context.currentTime + offset;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), startAt + duration);
    envelope.gain.setValueAtTime(0.0001, startAt);
    envelope.gain.linearRampToValueAtTime(volume, startAt + Math.min(0.025, duration / 3));
    envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(envelope);
    envelope.connect(this.master);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.015);
  }

  private playNoiseBurst(duration: number, cutoff: number, volume: number): void {
    if (!this.canPlay() || !this.context || !this.master) return;
    const context = this.context;
    const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * duration)), context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    const startAt = context.currentTime;
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.value = cutoff;
    filter.Q.value = 0.7;
    envelope.gain.setValueAtTime(0.0001, startAt);
    envelope.gain.linearRampToValueAtTime(volume, startAt + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master);
    source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
    source.start(startAt);
    source.stop(startAt + duration + 0.015);
  }
}
