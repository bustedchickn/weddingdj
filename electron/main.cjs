const { app, BrowserWindow, dialog, ipcMain, protocol, powerSaveBlocker } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { StateStore } = require('./state.cjs');
const { readAudio } = require('./media.cjs');
protocol.registerSchemesAsPrivileged([{scheme: 'dj-audio', privileges: {standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true}}]);
const development = process.argv.includes('--dev');
// Optional isolated profile for rehearsals and automated desktop tests.
if (process.env.WEDDING_DJ_DATA_DIR && path.isAbsolute(process.env.WEDDING_DJ_DATA_DIR)) app.setPath('userData', process.env.WEDDING_DJ_DATA_DIR);
let win, store, blocker, quitting = false;
const files = new Map();
const extensions = new Set(['.mp3','.wav','.ogg','.flac','.m4a','.aac','.aif','.aiff','.opus','.wma']);
async function log(message) {
  const file = path.join(app.getPath('userData'), 'diagnostics.log');
  try {
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.size > 2_000_000) await fs.rename(file, file + '.previous').catch(() => {});
    await fs.appendFile(file, `${new Date().toISOString()} ${String(message).slice(0, 2000)}\n`);
  } catch {}
}
function trusted(event) { if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw Error('Untrusted caller'); }
async function walk(folder, output, errors) {
  for (const item of await fs.readdir(folder, {withFileTypes: true})) {
    const full = path.join(folder, item.name);
    if (item.isDirectory()) { try { await walk(full, output, errors); } catch (e) { errors.push(`${item.name}: ${e.message}`); } }
    else if (item.isFile() && extensions.has(path.extname(full).toLowerCase())) output.push(full);
    if (output.length >= 20000) throw Error('Import limit is 20,000 files per batch. Import smaller folders.');
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    store = new StateStore(app.getPath('userData'));
    const loaded = await store.load();
    for (const track of loaded.state.tracks) files.set(track.id, track.path);
    protocol.handle('dj-audio', async request => {
      const url = new URL(request.url); const file = files.get(url.pathname.slice(1));
      if (url.hostname !== 'library' || !file) return new Response('Unknown imported file', {status: 404});
      try { return await readAudio(file, request); }
      catch (e) { void log(`Media read failed: ${e.message}`); return new Response('File unavailable', {status: 404}); }
    });
    ipcMain.handle('state:load', async event => { trusted(event); await store.pending.catch(() => {}); return store.load(); });
    ipcMain.handle('state:save', async (event, state) => {
      trusted(event);
      for (const track of state.tracks ?? []) if (files.get(track.id) !== track.path) throw Error('State contains an unregistered file');
      await store.save(state);
    });
    ipcMain.handle('library:import', async (event, kind) => {
      trusted(event); if (!['files','folder'].includes(kind)) throw Error('Invalid import type');
      const result = await dialog.showOpenDialog(win, {title: 'Import audio — originals remain untouched', properties: kind === 'folder' ? ['openDirectory'] : ['openFile','multiSelections'], filters: [{name: 'Audio', extensions: [...extensions].map(x => x.slice(1))}]});
      if (result.canceled) return {tracks: [], errors: []};
      const paths = []; const errors = []; const tracks = [];
      for (const file of result.filePaths) {
        if (kind === 'folder') { try { await walk(file, paths, errors); } catch (e) { errors.push(e.message); } }
        else paths.push(file);
      }
      const { parseFile } = await import('music-metadata');
      for (const file of [...new Set(paths)]) {
        try {
          const real = await fs.realpath(file);
          const id = createHash('sha256').update(process.platform === 'win32' ? real.toLowerCase() : real).digest('hex');
          let metadata, warning;
          try { metadata = await parseFile(real, {duration: true, skipCovers: true}); } catch (e) { warning = `Metadata unavailable: ${e.message}`; }
          const duration = metadata?.format.duration;
          tracks.push({id, path: real, filename: path.basename(real), title: metadata?.common.title || path.basename(real, path.extname(real)), artist: metadata?.common.artist || 'Unknown artist', duration: Number.isFinite(duration) ? duration : 0, ...(warning ? {warning} : {})});
          files.set(id, real);
        } catch (e) { errors.push(`${path.basename(file)}: ${e.message}`); }
      }
      if (errors.length) void log(`Import errors: ${errors.join('; ')}`);
      return {tracks, errors};
    });
    ipcMain.on('diagnostic', (event, message) => { trusted(event); void log(message); });
    ipcMain.on('playback', (event, active) => { trusted(event); if (active && blocker === undefined) blocker = powerSaveBlocker.start('prevent-app-suspension'); else if (!active && blocker !== undefined) { powerSaveBlocker.stop(blocker); blocker = undefined; } });
    win = new BrowserWindow({width: 1600, height: 960, minWidth: 1100, minHeight: 760, backgroundColor: '#101217', title: 'Wedding DJ Console', autoHideMenuBar: true, webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false}});
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('render-process-gone', (_, details) => { void log(`Renderer stopped: ${details.reason}`); dialog.showErrorBox('DJ console stopped', 'Playback has stopped. Restart the application to restore the saved library and queue.'); });
    win.on('close', event => {
      if (quitting) return;
      event.preventDefault();
      if (blocker !== undefined && dialog.showMessageBoxSync(win, {type: 'warning', buttons: ['Keep playing', 'Quit and stop audio'], defaultId: 0, cancelId: 0, message: 'Audio is playing. Quit Wedding DJ Console?'}) === 0) return;
      store.pending.catch(e => log(`Save on quit failed: ${e.message}`)).finally(() => { quitting = true; win.close(); });
    });
    if (development) await win.loadURL('http://127.0.0.1:5173'); else await win.loadFile(path.join(__dirname, '../dist/index.html'));
  }).catch(e => { void log(e.stack); dialog.showErrorBox('Startup failed', e.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
}
