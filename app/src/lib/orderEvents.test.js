// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { publishOrderChange, subscribeOrderChanges } from './orderEvents';

test('schedule listeners refresh immediately and in another tab without a manual reload', () => {
  const refresh = vi.fn();
  const unsubscribe = subscribeOrderChanges(refresh);
  publishOrderChange();
  expect(refresh).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new StorageEvent('storage', { key: 'shafan:orders-changed-at' }));
  expect(refresh).toHaveBeenCalledTimes(2);
  unsubscribe();
  publishOrderChange();
  expect(refresh).toHaveBeenCalledTimes(2);
});
