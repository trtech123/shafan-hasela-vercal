// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import PhysicalTerminalStatus from './PhysicalTerminalStatus.jsx';

afterEach(cleanup);

describe('physical terminal cashier status', () => {
  test.each([
    ['pending', 'ממתינים לתשלום במסופון'],
    ['uncertain', 'מצב התשלום טרם אומת'],
    ['declined', 'התשלום נדחה'],
    ['succeeded', 'התשלום אושר והמכירה נשמרה'],
  ])('%s state', (state, title) => {
    const onCheckStatus = vi.fn();
    render(<PhysicalTerminalStatus state={state} deviceName="דלפק ראשי" amount={24}
      onCheckStatus={onCheckStatus} onBack={vi.fn()} />);
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    expect(screen.getByText(/דלפק ראשי/)).toBeTruthy();
    if (state === 'uncertain') {
      expect(screen.getByText(/ייתכן שהחיוב בוצע/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'בדיקת מצב העסקה' }));
      expect(onCheckStatus).toHaveBeenCalledTimes(1);
    }
  });
});
