const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dj', {
  load: () => ipcRenderer.invoke('state:load'),
  save: state => ipcRenderer.invoke('state:save', state),
  import: kind => ipcRenderer.invoke('library:import', kind),
  log: message => ipcRenderer.send('diagnostic', String(message).slice(0, 2000)),
  playback: active => ipcRenderer.send('playback', Boolean(active))
});
