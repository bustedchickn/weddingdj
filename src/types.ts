export interface Track { id: string; path: string; filename: string; title: string; artist: string; duration: number; warning?: string }
export interface QueueItem { id: string; trackId: string }
export interface Playlist { id: string; name: string; trackIds: string[] }
export interface Pad { id: string; trackId: string; label: string; color: string; shortcut: string }
export type Mode = 'manual' | 'assisted' | 'automatic';
export interface State {
  version: 1; tracks: Track[]; queue: QueueItem[]; playlists: Playlist[]; pads: Pad[];
  settings: { master: number; soundboard: number; fade: number; mode: Mode; guestUrl: string };
}
export const emptyState = (): State => ({version: 1, tracks: [], queue: [], playlists: [], pads: [], settings: {master: .8, soundboard: .6, fade: 6, mode: 'manual', guestUrl: ''}});
export interface Bridge {
  load(): Promise<{state: State; warning?: string}>;
  save(state: State): Promise<void>;
  import(kind: 'files' | 'folder'): Promise<{tracks: Track[]; errors: string[]}>;
  log(message: string): void;
  playback(active: boolean): void;
}
declare global { interface Window { dj?: Bridge } }
