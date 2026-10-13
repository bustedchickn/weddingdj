import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { StateStore, emptyState, validate } = require('../electron/state.cjs');
const dirs: string[] = [];
async function setup() { const dir=await mkdtemp(path.join(tmpdir(),'wedding-dj-test-'));dirs.push(dir);return {dir,store:new StateStore(dir)}; }
afterEach(async()=>{await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
describe('durable persistence',()=>{
  it('restores library, repeated queue entries, playlists, pads and settings',async()=>{const {dir,store}=await setup();const state=emptyState();state.tracks=[{id:'a',path:path.resolve('original.wav'),filename:'original.wav',title:'First dance',artist:'Artist',duration:120}];state.queue=[{id:'q1',trackId:'a'},{id:'q2',trackId:'a'}];state.playlists=[{id:'p',name:'Reception',trackIds:['a']}];state.pads=[{id:'pad',trackId:'a',label:'Toast',color:'#abcdef',shortcut:'1'}];state.settings.fade=9;await store.save(state);expect((await new StateStore(dir).load()).state).toEqual(state);});
  it('serializes overlapping saves so latest state wins',async()=>{const {store}=await setup();const a=emptyState(),b=emptyState();b.settings.fade=2;await Promise.all([store.save(a),store.save(b)]);expect((await store.load()).state.settings.fade).toBe(2);});
  it('recovers a valid backup and preserves a corrupt original',async()=>{const {dir,store}=await setup();const a=emptyState();a.settings.fade=3;await store.save(a);await store.save(emptyState());await writeFile(path.join(dir,'state.json'),'broken');const loaded=await store.load();expect(loaded.state.settings.fade).toBe(3);expect(loaded.warning).toContain('Recovered');expect(await readFile(path.join(dir,'state.json'),'utf8')).toBe('broken');});
  it('rejects dangling queue references and invalid controls',()=>{const a=emptyState();a.queue=[{id:'q',trackId:'missing'}];expect(()=>validate(a)).toThrow('queue');const b=emptyState();b.settings.master=2;expect(()=>validate(b)).toThrow('settings');});
  it('returns a warning when both saves are damaged',async()=>{const {dir,store}=await setup();await writeFile(path.join(dir,'state.json'),'broken');expect((await store.load()).warning).toContain('preserved');});
});
