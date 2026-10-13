import type { QueueItem } from '../types';
export function moveItem(queue: QueueItem[], id: string, to: number): QueueItem[] {
  const from = queue.findIndex(x => x.id === id);
  if (from < 0) return queue;
  const result = [...queue]; const [item] = result.splice(from, 1);
  result.splice(Math.max(0, Math.min(result.length, to)), 0, item); return result;
}
export function removeItem(queue: QueueItem[], id: string) { return queue.filter(x => x.id !== id); }
export function equalPower(position: number): [number, number] {
  const x = Math.max(0, Math.min(1, position));
  return [Math.cos(x * Math.PI / 2), Math.sin(x * Math.PI / 2)];
}
export function fadeDuration(configured: number, remaining: number, incoming: number) {
  return Math.max(0, Math.min(15, configured, remaining, incoming / 2));
}
