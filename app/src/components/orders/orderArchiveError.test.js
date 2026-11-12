import { expect, test } from 'vitest';
import { orderArchiveError } from './orderArchiveError';

test('explains an unfinished financial workflow in Hebrew', () => {
  expect(orderArchiveError({ message: 'order_archive_unsettled_dependency' }))
    .toContain('תשלום או מסמך כספי שעדיין בטיפול');
});
