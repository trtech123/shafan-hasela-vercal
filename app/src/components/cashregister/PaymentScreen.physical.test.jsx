// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import PaymentScreen from './PaymentScreen';

afterEach(cleanup);

test('physical option is absent by default while digital and manual options remain', () => {
  render(<PaymentScreen total={24} cartItems={[{ id: 'p1' }]} onConfirm={vi.fn()} onBack={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /תשלום במסופון פיזי/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /פלאקארד/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /אשראי.*חיצוני/s })).toBeInTheDocument();
});

test('flag exposes separate physical action but cannot dispatch without provider activation', () => {
  const onPhysical = vi.fn();
  const onDigital = vi.fn();
  render(<PaymentScreen total={24} cartItems={[{ id: 'p1' }]} onConfirm={vi.fn()} onBack={vi.fn()}
    onPelecard={onDigital} onPhysicalTerminal={onPhysical} physicalTerminalVisible />);
  const physical = screen.getByRole('button', { name: /תשלום במסופון פיזי/ });
  expect(physical).toBeDisabled();
  fireEvent.click(physical);
  expect(onPhysical).not.toHaveBeenCalled();
  expect(onDigital).not.toHaveBeenCalled();
});

test('uncertain physical state offers status lookup without another charge', () => {
  const onPhysical = vi.fn();
  const onCheck = vi.fn();
  render(<PaymentScreen total={24} cartItems={[{ id: 'p1' }]} onConfirm={vi.fn()} onBack={vi.fn()}
    onPhysicalTerminal={onPhysical} onPhysicalStatusCheck={onCheck}
    physicalTerminalState="uncertain" physicalDeviceName="CT20 004" physicalTerminalVisible />);
  expect(screen.getByText(/ייתכן שהחיוב בוצע/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'בדיקת מצב העסקה' }));
  expect(onCheck).toHaveBeenCalledTimes(1);
  expect(onPhysical).not.toHaveBeenCalled();
});

test('physical action stays separate from hosted checkout when explicitly enabled', () => {
  const onPhysical = vi.fn();
  const onDigital = vi.fn();
  render(<PaymentScreen total={24} cartItems={[{ id: 'p1' }]} onConfirm={vi.fn()} onBack={vi.fn()}
    onPelecard={onDigital} onPhysicalTerminal={onPhysical} physicalTerminalVisible physicalTerminalEnabled />);
  fireEvent.click(screen.getByRole('button', { name: /תשלום במסופון פיזי/ }));
  expect(onPhysical).toHaveBeenCalledTimes(1);
  expect(onDigital).not.toHaveBeenCalled();
  expect(screen.getByText('הסכום נשלח אוטומטית למסופון המשויך לקופה')).toBeInTheDocument();
});
