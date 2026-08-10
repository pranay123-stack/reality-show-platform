import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { apiMock, renderScreen } from '../helpers/render';

import { LoginForm } from '@/components/auth/login-form';
import { NotificationPage } from '@/components/notifications/notification-page';
import { PollsScreen } from '@/components/polls/polls-screen';
import { RewardsPage } from '@/components/rewards/rewards-page';

/**
 * Keyboard reachability and form feedback.
 *
 * Nothing here needs a mouse. Anything that cannot be reached by Tab and
 * operated by Enter or Space is unreachable for a keyboard user, however good
 * it looks.
 */

/** The catalogue is empty on purpose; the chips are what these tests drive. */
const REWARDS_ROUTES = {
  '/rewards/me/level': { level: 3, pointsIntoLevel: 300, pointsForNextLevel: 700 },
  '/rewards': [],
};

describe('keyboard navigation', () => {
  it('reaches the filter chips and switches filter with the keyboard alone', async () => {
    const user = userEvent.setup();
    renderScreen(<RewardsPage />, { routes: REWARDS_ROUTES });

    await screen.findByRole('heading', { level: 1 });
    const group = screen.getByRole('group', { name: /reward categories/i });
    const chips = within(group).getAllByRole('button');

    chips[0]!.focus();
    await user.tab();
    expect(chips[1]).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(chips[1]).toHaveAttribute('aria-pressed', 'true');
  });

  it('operates a chip with Space as well as Enter', async () => {
    const user = userEvent.setup();
    renderScreen(<RewardsPage />, { routes: REWARDS_ROUTES });

    await screen.findByRole('heading', { level: 1 });
    const chips = within(screen.getByRole('group', { name: /reward categories/i })).getAllByRole(
      'button',
    );

    chips[1]!.focus();
    await user.keyboard(' ');
    expect(chips[1]).toHaveAttribute('aria-pressed', 'true');
  });

  it('never leaves a focusable control without an accessible name', async () => {
    renderScreen(<NotificationPage />, { routes: { '/notifications': { items: [], unread: 0 } } });
    await screen.findByRole('heading', { level: 1 });

    for (const control of [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]) {
      const name =
        control.getAttribute('aria-label') ??
        control.getAttribute('title') ??
        control.textContent?.trim();
      expect(name, `${control.tagName} has no accessible name`).toBeTruthy();
    }
  });

  it('keeps every interactive control in the natural tab order', async () => {
    renderScreen(<PollsScreen />, { routes: { '/polls': [] } });
    await screen.findByRole('heading', { level: 1 });

    for (const control of screen.queryAllByRole('button')) {
      // A positive tabindex reorders the document for everyone downstream.
      const index = control.getAttribute('tabindex');
      expect(index === null || Number(index) <= 0).toBe(true);
    }
  });
});

describe('form feedback', () => {
  it('reports a validation failure against the field it belongs to', async () => {
    const user = userEvent.setup();
    renderScreen(<LoginForm />, { user: null });

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    const email = screen.getByLabelText(/email/i);
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));

    // The message is associated, not merely nearby.
    const describedBy = email.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBeTruthy();
  });

  it('marks required fields as required', async () => {
    renderScreen(<LoginForm />, { user: null });

    expect(screen.getByLabelText(/email/i)).toBeRequired();
    expect(screen.getByLabelText(/password/i)).toBeRequired();
  });

  it('does not submit an invalid form to the server', async () => {
    const user = userEvent.setup();
    renderScreen(<LoginForm />, { user: null });

    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toHaveAttribute('aria-invalid', 'true'));

    expect(apiMock.post).not.toHaveBeenCalledWith('/auth/login', expect.anything());
  });

  it('announces a rejected sign-in and keeps what was typed', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/lib/api-client');
    apiMock.post.mockRejectedValueOnce(
      new ApiError(401, { code: 'UNAUTHORIZED', message: 'Email or password is incorrect' }, 'Sign-in failed'),
    );

    renderScreen(<LoginForm />, { user: null });

    await user.type(screen.getByLabelText(/email/i), 'viewer1@reality.local');
    await user.type(screen.getByLabelText(/password/i), 'WrongPassword1!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/incorrect/i);
    // Retyping an email after a failed attempt is a small cruelty.
    expect(screen.getByLabelText(/email/i)).toHaveValue('viewer1@reality.local');
  });

  it('disables the submit button while the request is in flight', async () => {
    const user = userEvent.setup();
    apiMock.post.mockImplementationOnce(() => new Promise(() => {}));

    renderScreen(<LoginForm />, { user: null });

    await user.type(screen.getByLabelText(/email/i), 'viewer1@reality.local');
    await user.type(screen.getByLabelText(/password/i), 'DemoPass!2026');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Double-submitting a sign-in burns a rate-limit slot for no reason.
    await waitFor(() => expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled());
    expect(screen.getByRole('button', { name: /sign in/i })).toHaveAttribute('aria-busy', 'true');
  });
});
