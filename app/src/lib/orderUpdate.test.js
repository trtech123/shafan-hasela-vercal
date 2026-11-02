import { expect, test } from 'vitest';
import { changedOrderFields } from './orderUpdate';

test('changing a date does not overwrite payment state, instructor, quote, or unchanged times', () => {
  const before = { activity_date: '2026-11-10', start_time: '10:00:00', end_time: '11:00:00', instructor_id: 'i1', quote_id: 'q1', payment_status: 'שולם', total_price: 35 };
  const after = { ...before, activity_date: '2026-11-11', start_time: '10:00', end_time: '11:00', total_price: 35 };
  expect(changedOrderFields(before, after)).toEqual({ activity_date: '2026-11-11' });
});
