import { createHash } from 'node:crypto';
export function eventKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9-]{1,80}$/.test(value)) throw Error('Invalid event.'); return value;
}
export function text(value: unknown): string {
  if (typeof value !== 'string') throw Error('Enter a song title and artist.');
  const cleaned = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length > 120 || /https?:\/\//i.test(cleaned)) throw Error('Use 1–120 characters, without links.');
  return cleaned;
}
export function requestKey(title: string, artist: string) {
  const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return createHash('sha256').update(JSON.stringify([normalize(title), normalize(artist)])).digest('hex');
}
export function checkQuota(quota: {count?: number; lastAt?: number} | undefined, now: number, maximum: number, cooldown: number) {
  if ((quota?.count || 0) >= maximum) throw Error(`Limit reached (${maximum} per guest for this event).`);
  if (now - (quota?.lastAt || 0) < cooldown) throw Error('Please wait before trying again.');
}
