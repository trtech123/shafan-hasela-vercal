// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import SiteOpeningPrompt from './SiteOpeningPrompt';

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: 'אחמ"ש' } }) }));
afterEach(cleanup);

test('one shared safety form opens in a new tab for both sites', () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  const { container } = render(<SiteOpeningPrompt />);
  expect(container.firstChild).toHaveAttribute('dir', 'rtl');
  fireEvent.click(screen.getByRole('button', { name: /שאלון בטיחות/ }));
  expect(open).toHaveBeenCalledWith('https://devout-daily-shift-pulse.base44.app', '_blank', 'noopener,noreferrer');
  expect(screen.queryByRole('button', { name: /אקסטרים ברקו/ })).not.toBeInTheDocument();
  open.mockRestore();
});
