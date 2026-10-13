import { describe, expect, it, vi } from 'vitest';
import { DJEngine, type Mixer, type Transport } from '../src/audio/engine';
import type { Track, QueueItem } from '../src/types';
class FakePort implements Transport {
  pos = 0; length = 30; running = false; failLoad = false; failPlay = false; loader?: () => Promise<number>;
  load = vi.fn(async () => { this.pos=0; if (this.failLoad) throw Error('Corrupt file'); return this.loader ? this.length = await this.loader() : this.length; });
  async play() { if (this.failPlay) throw Error('Output failed'); this.running = true; }
  pause() { this.running=false; } seek(time: number) { this.pos=time; }
  position() { return this.pos; } duration() { return this.length; } playing() { return this.running; } ended() { return !this.running && this.pos >= this.length; } dispose() {}
}
const track = (id: string): Track => ({id, path: `C:\\music\\${id}.wav`, title: id, artist: 'Test', filename: `${id}.wav`, duration: 30});
function setup() {
  const ports: [FakePort, FakePort] = [new FakePort(), new FakePort()]; let now=0;
  let queue: QueueItem[] = ['b','c'].map(id => ({id: `q-${id}`, trackId: id}));
  const mixer: Mixer = {now: () => now, resume: async () => {}, crossfade: vi.fn(), deckVolume: vi.fn(), masterVolume: vi.fn(), dispose: vi.fn()};
  const report=vi.fn(); const consume=vi.fn((id: string) => {queue=queue.filter(q => q.id!==id);});
  const engine=new DJEngine(ports,mixer,()=>queue,id=>track(id),consume,report);
  return {engine,ports,mixer,report,consume,queue:()=>queue,setQueue:(q: QueueItem[])=>{queue=q;},advance:(n:number)=>{now+=n;}};
}
describe('deck protection and transitions',()=>{
  it('rejects replacing a playing deck',async()=>{const {engine}=setup();await engine.load(0,track('a'));await engine.play(0);await expect(engine.load(0,track('c'))).rejects.toThrow('Pause');expect(engine.decks[0].track?.id).toBe('a');});
  it('keeps outgoing music when the incoming deck fails to start',async()=>{const {engine,ports,mixer}=setup();await engine.load(0,track('a'));await engine.play(0);await engine.load(1,track('b'));ports[1].failPlay=true;vi.mocked(mixer.crossfade).mockClear();await expect(engine.transitionTo(1)).rejects.toThrow('Output');expect(ports[0].playing()).toBe(true);expect(mixer.crossfade).not.toHaveBeenCalled();});
  it('consumes next once playback starts and stops outgoing after fade',async()=>{const s=setup();await s.engine.load(0,track('a'));await s.engine.play(0);await s.engine.next();expect(s.consume).toHaveBeenCalledExactlyOnceWith('q-b');expect(s.ports[0].playing()).toBe(true);expect(s.ports[1].playing()).toBe(true);s.advance(6);await s.engine.tick();expect(s.ports[0].playing()).toBe(false);expect(s.engine.fader).toBe(1);expect(s.engine.snapshot().transitioning).toBe(false);});
  it('uses zero-second transitions without leaving the previous deck playing',async()=>{const s=setup();s.engine.fadeSeconds=0;await s.engine.load(0,track('a'));await s.engine.play(0);await s.engine.next();expect(s.ports[0].playing()).toBe(false);expect(s.ports[1].playing()).toBe(true);});
  it('selects the still-playing deck after the active deck is paused',async()=>{const s=setup();await s.engine.load(0,track('a'));await s.engine.play(0);await s.engine.load(1,track('b'));await s.engine.play(1);s.engine.pause(0);expect(s.engine.active).toBe(1);await s.engine.next();expect(s.engine.decks[0].track?.id).toBe('b');expect(s.consume).toHaveBeenCalledExactlyOnceWith('q-b');});
  it('reports an occupied standby deck without losing queued entries',async()=>{const s=setup();await s.engine.load(0,track('a'));await s.engine.play(0);await s.engine.load(1,track('b'));await s.engine.play(1);await s.engine.next();expect(s.consume).not.toHaveBeenCalled();expect(s.report).toHaveBeenCalledWith(expect.stringContaining('No idle deck'));});
});
describe('Auto DJ reservations and failures',()=>{
  it('prepares without playing in assisted mode',async()=>{const s=setup();s.engine.mode='assisted';await s.engine.load(0,track('a'));await s.engine.play(0);await s.engine.tick();expect(s.engine.decks[1].track?.id).toBe('b');expect(s.ports[1].playing()).toBe(false);expect(s.queue()).toHaveLength(2);});
  it('automatically starts a prepared track at the fade threshold',async()=>{const s=setup();s.engine.mode='automatic';await s.engine.load(0,track('a'));await s.engine.play(0);await s.engine.tick();s.ports[0].pos=24;await s.engine.tick();expect(s.consume).toHaveBeenCalledExactlyOnceWith('q-b');expect(s.ports[1].playing()).toBe(true);});
  it('does not start on restore or after a deliberate pause',async()=>{const s=setup();s.engine.mode='automatic';await s.engine.tick();expect(s.consume).not.toHaveBeenCalled();await s.engine.load(0,track('a'));await s.engine.play(0);s.engine.pause(0);await s.engine.tick();expect(s.ports[1].playing()).toBe(false);});
  it('does not resume when deliberately paused close to the end',async()=>{const s=setup();s.engine.mode='automatic';await s.engine.load(0,track('a'));await s.engine.play(0);s.ports[0].pos=29.99;s.engine.pause(0);await s.engine.tick();expect(s.consume).not.toHaveBeenCalled();});
  it('handles empty queues without stopping the current song',async()=>{const s=setup();s.setQueue([]);await s.engine.load(0,track('a'));await s.engine.play(0);await s.engine.next();expect(s.ports[0].playing()).toBe(true);expect(s.report).toHaveBeenCalledWith(expect.stringContaining('empty'));});
  it('skips broken queued files with a diagnostic and no uncaught failure',async()=>{const s=setup();s.ports[1].failLoad=true;await s.engine.next();expect(s.queue()).toHaveLength(0);expect(s.report).toHaveBeenCalledWith(expect.stringContaining('Corrupt file'));});
  it('does not play a reservation removed while loading',async()=>{const s=setup();let finish!:(n:number)=>void;s.ports[1].loader=()=>new Promise(resolve=>{finish=resolve;});const next=s.engine.next();s.setQueue([]);finish(30);await next;expect(s.ports[1].playing()).toBe(false);expect(s.consume).not.toHaveBeenCalled();});
  it('reloads when the queue is reordered after preparation',async()=>{const s=setup();s.engine.mode='assisted';await s.engine.load(0,track('a'));await s.engine.play(0);await s.engine.tick();s.setQueue([{id:'q-c',trackId:'c'},{id:'q-b',trackId:'b'}]);await s.engine.next();expect(s.engine.decks[1].track?.id).toBe('c');expect(s.consume).toHaveBeenCalledExactlyOnceWith('q-c');});
  it('clamps a fade to half the incoming short track',async()=>{const s=setup();s.ports[1].length=2;await s.engine.load(0,track('a'));await s.engine.play(0);await s.engine.next();expect(s.mixer.crossfade).toHaveBeenLastCalledWith(1,1,0);});
});
