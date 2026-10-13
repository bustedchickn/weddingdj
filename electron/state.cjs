const fs = require('node:fs/promises');
const path = require('node:path');
function emptyState() { return { version: 1, tracks: [], queue: [], playlists: [], pads: [], settings: {master: .8, soundboard: .6, fade: 6, mode: 'manual', guestUrl: ''} }; }
function validate(s) {
  if (!s || s.version !== 1 || !Array.isArray(s.tracks) || !Array.isArray(s.queue) || !Array.isArray(s.pads) || !Array.isArray(s.playlists)) throw Error('Invalid saved state');
  const ids = new Set();
  for (const t of s.tracks) {
    if (!t || typeof t.id !== 'string' || ids.has(t.id) || typeof t.path !== 'string' || !path.isAbsolute(t.path) || ['filename','title','artist'].some(k => typeof t[k] !== 'string') || !Number.isFinite(t.duration) || t.duration < 0) throw Error('Invalid library entry');
    ids.add(t.id);
  }
  const qids = new Set();
  for (const q of s.queue) { if (!q || typeof q.id !== 'string' || qids.has(q.id) || !ids.has(q.trackId)) throw Error('Invalid queue entry'); qids.add(q.id); }
  for (const p of s.playlists) if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || !Array.isArray(p.trackIds) || p.trackIds.some(id => !ids.has(id))) throw Error('Invalid playlist');
  for (const p of s.pads) if (!p || typeof p.id !== 'string' || !ids.has(p.trackId) || typeof p.label !== 'string' || !/^#[0-9a-f]{6}$/i.test(p.color) || typeof p.shortcut !== 'string' || p.shortcut.length > 1) throw Error('Invalid sound button');
  if (!s.settings || ['master','soundboard','fade'].some(k => !Number.isFinite(s.settings[k])) || s.settings.master < 0 || s.settings.master > 1 || s.settings.soundboard < 0 || s.settings.soundboard > 1 || s.settings.fade < 0 || s.settings.fade > 15 || !['manual','assisted','automatic'].includes(s.settings.mode) || typeof s.settings.guestUrl !== 'string') throw Error('Invalid settings');
  return s;
}
class StateStore {
  constructor(dir) { this.dir = dir; this.file = path.join(dir, 'state.json'); this.pending = Promise.resolve(); }
  async load() {
    try { return {state: validate(JSON.parse(await fs.readFile(this.file, 'utf8')))}; }
    catch (e) {
      if (e.code === 'ENOENT') return {state: emptyState()};
      try { return {state: validate(JSON.parse(await fs.readFile(this.file + '.bak', 'utf8'))), warning: 'Saved state was damaged. Recovered the previous backup.'}; }
      catch { return {state: emptyState(), warning: 'Saved state could not be read. Original state files were preserved; consult diagnostics before importing again.'}; }
    }
  }
  save(state) {
    const data = JSON.stringify(validate(state));
    const work = this.pending.catch(() => {}).then(async () => {
      await fs.mkdir(this.dir, {recursive: true});
      const temp = this.file + '.tmp';
      const handle = await fs.open(temp, 'w');
      try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
      // Only replace the backup with a validated previous state.
      try {
        const previous = await fs.readFile(this.file, 'utf8');
        try { validate(JSON.parse(previous)); await fs.copyFile(this.file, this.file + '.bak'); }
        catch { await fs.copyFile(this.file, this.file + `.corrupt-${Date.now()}`); }
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
      await fs.rename(temp, this.file);
    });
    this.pending = work; return work;
  }
}
module.exports = { StateStore, validate, emptyState };
