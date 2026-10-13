import type { Mode, QueueItem, Track } from '../types';
import { equalPower, fadeDuration } from '../core/queue';
export type Side = 0 | 1;
export interface Transport {
  load(track: Track): Promise<number>; play(): Promise<void>; pause(): void; seek(time: number): void;
  position(): number; duration(): number; playing(): boolean; ended(): boolean; failure?(): string | undefined; dispose(): void;
}
export interface Mixer {
  now(): number; resume(): Promise<void>; crossfade(x: number, duration?: number, from?: number): void;
  deckVolume(side: Side, value: number): void; masterVolume(value: number): void; dispose(): void;
}
export interface DeckView { track?: Track; duration: number; position: number; playing: boolean; loading: boolean; volume: number; error?: string }
export interface EngineView { decks: [DeckView, DeckView]; fader: number; transitioning: boolean; active: Side; mode: Mode }
export class DJEngine {
  decks: [DeckView, DeckView] = [this.blank(), this.blank()];
  active: Side = 0; fader = 0; mode: Mode = 'manual'; fadeSeconds = 6;
  private transition?: {from: Side; to: Side; start: number; duration: number; startFader: number};
  private prepared?: {itemId: string; side: Side};
  private busy = false; private disposed = false; private versions = [0, 0];
  private listeners = new Set<() => void>();
  constructor(private ports: [Transport, Transport], public mixer: Mixer, private queue: () => QueueItem[], private find: (id: string) => Track | undefined, private consume: (id: string) => void, private report: (message: string) => void) {}
  private blank(): DeckView { return {duration: 0, position: 0, playing: false, loading: false, volume: 1}; }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot(): EngineView { return {decks: this.decks.map(d => ({...d})) as EngineView['decks'], fader: this.fader, transitioning: !!this.transition, active: this.active, mode: this.mode}; }
  private emit() { if (!this.disposed) this.listeners.forEach(fn => fn()); }
  async load(side: Side, track: Track) {
    if (this.ports[side].playing() || this.transition) throw Error('Pause this deck before replacing its song.');
    const version = ++this.versions[side];
    if (this.prepared?.side === side) this.prepared = undefined;
    this.decks[side] = {...this.blank(), volume: this.decks[side].volume, loading: true, track}; this.emit();
    try {
      const duration = await this.ports[side].load(track);
      if (this.disposed || version !== this.versions[side]) return;
      if (!Number.isFinite(duration) || duration <= 0) throw Error('No playable audio duration was found.');
      this.decks[side].duration = duration;
    } catch (e) {
      if (version === this.versions[side]) this.decks[side].error = String(e);
      throw e;
    } finally { if (version === this.versions[side]) this.decks[side].loading = false; this.emit(); }
  }
  async play(side: Side) {
    if (this.decks[side].loading || !this.decks[side].track || this.decks[side].error) throw Error('Load a playable song first.');
    await this.mixer.resume();
    if (this.ports[side].position() >= this.ports[side].duration() - .02) this.ports[side].seek(0);
    await this.ports[side].play();
    this.decks[side].playing = true;
    if (this.prepared?.side === side) { const id = this.prepared.itemId; this.prepared = undefined; this.consume(id); }
    if (!this.ports[(1 - side) as Side].playing()) { this.active = side; this.setFader(side); }
    this.emit();
  }
  pause(side: Side) {
    // Pausing during a transition freezes the mix and returns control to the DJ.
    if (this.transition) { this.cancelTransition(); this.mode = 'manual'; this.report('Transition paused. Manual mode selected.'); }
    this.ports[side].pause(); this.decks[side].playing = false; this.emit();
    if (this.active === side && this.ports[(1 - side) as Side].playing()) this.active = (1 - side) as Side;
  }
  seek(side: Side, time: number) { if (this.transition) throw Error('Finish or cancel the transition before seeking.'); this.ports[side].seek(Math.max(0, Math.min(this.decks[side].duration, time))); this.emit(); }
  volume(side: Side, value: number) { this.decks[side].volume = Math.max(0, Math.min(1, value)); this.mixer.deckVolume(side, this.decks[side].volume); this.emit(); }
  private progressFader() {
    if (!this.transition) return this.fader;
    const t = this.transition; const ratio = Math.min(1, Math.max(0, (this.mixer.now() - t.start) / Math.max(.001, t.duration)));
    return t.startFader + (t.to - t.startFader) * ratio;
  }
  cancelTransition() { this.fader = this.progressFader(); this.transition = undefined; this.mixer.crossfade(this.fader); this.emit(); }
  setFader(value: number) { this.transition = undefined; this.fader = Math.max(0, Math.min(1, value)); this.mixer.crossfade(this.fader); this.emit(); }
  async transitionTo(to: Side, seconds = this.fadeSeconds) {
    if (this.transition) throw Error('A transition is already running.');
    const from = (1 - to) as Side;
    const startFader = this.fader;
    await this.play(to); // Do not change outgoing gain until incoming playback succeeds.
    const duration = fadeDuration(seconds, this.ports[from].playing() ? this.ports[from].duration() - this.ports[from].position() : 0, this.ports[to].duration() - this.ports[to].position());
    this.active = to;
    if (duration === 0) { this.ports[from].pause(); this.decks[from].playing = false; this.setFader(to); }
    else { this.fader = startFader; this.transition = {from, to, start: this.mixer.now(), duration, startFader}; this.mixer.crossfade(to, duration, startFader); }
    this.emit();
  }
  async next() {
    if (this.busy || this.transition) return;
    this.busy = true;
    try {
      if (await this.prepare()) await this.beginPrepared();
      else this.report(this.queue().length ? 'No idle deck is ready for the queue. Pause the other deck and check any file errors.' : 'Queue is empty. Add a song to continue.');
    }
    finally { this.busy = false; }
  }
  private async prepare(): Promise<boolean> {
    const side = (1 - this.active) as Side;
    if (this.ports[side].playing()) return false;
    let attempts = 0;
    while (!this.disposed && attempts++ < 20) {
      const head = this.queue()[0]; if (!head) { this.prepared = undefined; return false; }
      if (this.prepared?.itemId === head.id && this.prepared.side === side && !this.decks[side].error) return true;
      const track = this.find(head.trackId);
      if (!track) { this.consume(head.id); this.report('Skipped a missing library entry.'); continue; }
      try {
        await this.load(side, track);
        if (this.queue()[0]?.id !== head.id || side !== (1 - this.active)) continue;
        this.prepared = {itemId: head.id, side}; return true;
      } catch (e) { if (this.queue()[0]?.id === head.id) this.consume(head.id); this.report(`Skipped “${track.title}”: ${String(e)}`); }
    }
    return false;
  }
  private async beginPrepared() {
    const prepared = this.prepared;
    if (!prepared || this.queue()[0]?.id !== prepared.itemId) return;
    try { await this.transitionTo(prepared.side); }
    catch (e) { this.prepared = undefined; this.consume(prepared.itemId); this.report(`Next song could not start and was skipped: ${String(e)}`); }
  }
  async tick() {
    if (this.disposed) return;
    for (const side of [0, 1] as Side[]) { this.decks[side].position = this.ports[side].position(); this.decks[side].playing = this.ports[side].playing(); }
    if (this.transition) {
      this.fader = this.progressFader();
      if (this.mixer.now() >= this.transition.start + this.transition.duration) {
        const {from, to} = this.transition; this.ports[from].pause(); this.decks[from].playing = false; this.setFader(to);
      }
    }
    this.emit();
    if (this.busy || this.transition || this.mode === 'manual') return;
    const port = this.ports[this.active];
    const ended = !!this.decks[this.active].track && port.ended();
    const failed = port.failure?.();
    if (failed && this.decks[this.active].error !== failed) { this.decks[this.active].error = failed; this.report(failed); }
    if (!port.playing() && !ended && !failed) return; // Never restart deliberately paused music.
    this.busy = true;
    try {
      if (await this.prepare()) {
        const remaining = Math.max(0, port.duration() - port.position());
        const incoming = this.decks[this.prepared!.side].duration;
        if (this.mode === 'automatic' && (ended || failed || remaining <= fadeDuration(this.fadeSeconds, remaining, incoming) + .12)) await this.beginPrepared();
      }
    } finally { this.busy = false; }
  }
  dispose() { this.disposed = true; this.versions = this.versions.map(v => v + 1); this.ports.forEach(p => p.dispose()); this.mixer.dispose(); this.listeners.clear(); }
}

export class MediaTransport implements Transport {
  readonly element = new Audio();
  private cleanup?: () => void;
  private disposed = false;
  constructor(context: AudioContext, output: AudioNode, private url: (track: Track) => string) {
    this.element.preload = 'auto'; this.element.crossOrigin = 'anonymous'; context.createMediaElementSource(this.element).connect(output);
  }
  load(track: Track): Promise<number> {
    this.cleanup?.(); this.element.pause();
    return new Promise((resolve, reject) => {
      let settled = false;
      const clear = () => { clearTimeout(timeout); this.element.removeEventListener('canplay', ready); this.element.removeEventListener('error', fail); this.cleanup = undefined; };
      const ready = () => { if (settled) return; settled = true; clear(); resolve(this.element.duration); };
      const fail = () => { if (settled) return; settled = true; clear(); reject(Error(`Cannot decode or read ${track.filename}. The file may be missing, corrupt, or unsupported.`)); };
      const timeout = setTimeout(fail, 15000);
      this.cleanup = () => { if (!settled) { settled = true; clear(); reject(Error('Load canceled.')); } };
      this.element.addEventListener('canplay', ready); this.element.addEventListener('error', fail);
      if (this.disposed) { fail(); return; }
      this.element.src = this.url(track); this.element.load();
    });
  }
  async play() { await this.element.play(); }
  pause() { this.element.pause(); }
  seek(time: number) { this.element.currentTime = time; }
  position() { return this.element.currentTime || 0; }
  duration() { return Number.isFinite(this.element.duration) ? this.element.duration : 0; }
  playing() { return !this.element.paused && !this.element.ended; }
  ended() { return this.element.ended; }
  failure() { return this.element.error ? 'Audio playback failed. The source file or audio device is unavailable.' : undefined; }
  dispose() { this.disposed = true; this.cleanup?.(); this.element.pause(); this.element.removeAttribute('src'); this.element.load(); }
}
export class WebMixer implements Mixer {
  readonly context = new AudioContext({latencyHint: 'playback'});
  readonly inputs = [this.context.createGain(), this.context.createGain()] as [GainNode, GainNode];
  readonly cross = [this.context.createGain(), this.context.createGain()] as [GainNode, GainNode];
  readonly soundboard = this.context.createGain();
  readonly master = this.context.createGain();
  readonly meter = this.context.createAnalyser();
  private effects = new Map<string, {audio: HTMLAudioElement; source: MediaElementAudioSourceNode; stop: () => void}>();
  private effectVersions = new Map<string, number>();
  constructor() {
    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -3; compressor.knee.value = 0; compressor.ratio.value = 20; compressor.attack.value = .003; compressor.release.value = .15;
    this.inputs.forEach((input, i) => { input.connect(this.cross[i]); this.cross[i].connect(this.master); });
    this.soundboard.connect(this.master); this.master.connect(compressor); compressor.connect(this.meter); this.meter.connect(this.context.destination);
    this.meter.fftSize = 256; this.master.gain.value = .8; this.soundboard.gain.value = .6; this.crossfade(0);
  }
  now() { return this.context.currentTime; }
  async resume() { await this.context.resume(); if (this.context.state !== 'running') throw Error('Audio output is unavailable. Check the Windows audio device.'); }
  crossfade(x: number, duration = 0, from = x) {
    const now = this.now();
    this.cross.forEach((node, side) => {
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(equalPower(from)[side], now);
      if (duration > 0) {
        const values = new Float32Array(128);
        for (let i = 0; i < values.length; i++) values[i] = equalPower(from + (x - from) * i / (values.length - 1))[side];
        node.gain.setValueCurveAtTime(values, now, duration);
      } else node.gain.setValueAtTime(equalPower(x)[side], now);
    });
  }
  deckVolume(side: Side, value: number) { this.inputs[side].gain.setTargetAtTime(value, this.now(), .015); }
  masterVolume(value: number) { this.master.gain.setTargetAtTime(value, this.now(), .015); }
  soundVolume(value: number) { this.soundboard.gain.setTargetAtTime(value, this.now(), .015); }
  peak() { const data = new Float32Array(this.meter.fftSize); this.meter.getFloatTimeDomainData(data); return data.reduce((max, n) => Math.max(max, Math.abs(n)), 0); }
  effectPlaying(id: string) { return this.effects.has(id); }
  async effect(id: string, url: string) {
    this.stopEffect(id);
    const version = this.effectVersions.get(id)!;
    await this.resume();
    if (this.effectVersions.get(id) !== version) return;
    if (this.effects.size >= 12) throw Error('Twelve effects are already playing. Stop an effect before adding another.');
    const audio = new Audio(); audio.crossOrigin = 'anonymous'; audio.src = url; const source = this.context.createMediaElementSource(audio); source.connect(this.soundboard);
    const stop = () => { audio.pause(); audio.removeAttribute('src'); audio.load(); source.disconnect(); if (this.effects.get(id)?.audio === audio) this.effects.delete(id); };
    this.effects.set(id, {audio, source, stop}); audio.addEventListener('ended', stop, {once: true});
    audio.addEventListener('error', stop, {once: true});
    try { await audio.play(); } catch (e) { stop(); if (this.effectVersions.get(id) === version) throw Error(`Sound effect could not play: ${String(e)}`); }
  }
  stopEffect(id: string) { this.effectVersions.set(id, (this.effectVersions.get(id) || 0) + 1); this.effects.get(id)?.stop(); }
  stopEffects() { [...this.effectVersions.keys()].forEach(id => this.stopEffect(id)); }
  dispose() { this.stopEffects(); void this.context.close(); }
}
