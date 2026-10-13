import { describe, expect, it } from 'vitest';
import { equalPower, fadeDuration, moveItem, removeItem } from '../src/core/queue';
const queue = ['a','b','c'].map(id => ({id, trackId: 'same-song'}));
describe('queue identity and order', () => {
  it('moves repeated songs by queue identity without mutating input', () => { expect(moveItem(queue, 'b', 0).map(q => q.id)).toEqual(['b','a','c']); expect(queue.map(q => q.id)).toEqual(['a','b','c']); });
  it('clamps bounds and handles absent entries', () => { expect(moveItem(queue, 'a', 99).map(q => q.id)).toEqual(['b','c','a']); expect(moveItem(queue, 'missing', 0)).toBe(queue); });
  it('removes only the selected occurrence', () => { expect(removeItem(queue, 'b').map(q => q.id)).toEqual(['a','c']); });
});
describe('transition math', () => {
  it('preserves equal power across the entire travel', () => { for (let i=0;i<=100;i++) { const [a,b] = equalPower(i/100); expect(a*a+b*b).toBeCloseTo(1, 12); } expect(equalPower(0)).toEqual([1,0]); expect(equalPower(1)[1]).toBe(1); });
  it('limits fades for short songs, end of track and zero fades', () => { expect(fadeDuration(15, 2, 30)).toBe(2); expect(fadeDuration(15, 30, 4)).toBe(2); expect(fadeDuration(0, 30, 30)).toBe(0); expect(fadeDuration(40, 40, 40)).toBe(15); });
});
