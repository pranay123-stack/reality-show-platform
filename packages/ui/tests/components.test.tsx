import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterChips,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
  statusTone,
} from '../src/index';

/**
 * Regression tests for the shared surface.
 *
 * These exist because the drift they guard against already happened once: two
 * different `h1` treatments, three different chip heights, and `role="tab"` on
 * controls that never implemented the tab keyboard contract.
 */

describe('PageHeader', () => {
  it('renders the title as the page h1 with the description beneath', () => {
    render(<PageHeader title="Live Polls" description="Vote while the episode is on air." />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Live Polls');
    expect(screen.getByText('Vote while the episode is on air.')).toBeInTheDocument();
  });

  it('uses one heading treatment for both sizes so screens cannot drift apart', () => {
    const { rerender } = render(<PageHeader title="Audience" />);
    const display = screen.getByRole('heading', { level: 1 }).className;

    rerender(<PageHeader title="Console" size="compact" />);
    const compact = screen.getByRole('heading', { level: 1 }).className;

    // Different sizes, but both come from the component rather than the screen.
    expect(display).toContain('text-display-md');
    expect(compact).toContain('text-2xl');
    expect(display).not.toBe(compact);
  });

  it('renders an action and keeps it out of the heading', () => {
    render(<PageHeader title="Rewards" action={<Button>Redeem</Button>} />);

    expect(screen.getByRole('button', { name: 'Redeem' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Rewards');
  });

  it('can step down to h2 for a header on a page that already owns the h1', () => {
    render(<PageHeader title="Nested" as="h2" />);

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Nested');
  });
});

describe('SectionCard', () => {
  it('titles the section at h2, below the page h1', () => {
    render(
      <SectionCard title="Participation" description="People taking part each day.">
        <p>body</p>
      </SectionCard>,
    );

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Participation');
    expect(screen.getByText('People taking part each day.')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('keeps the body in a min-w-0 box so wide content scrolls instead of widening the page', () => {
    // The 204 px overflow found in the analytics dashboard was exactly this:
    // a grid item that refused to shrink below its content's intrinsic width.
    render(
      <SectionCard title="Events">
        <div data-testid="body">wide</div>
      </SectionCard>,
    );

    expect(screen.getByTestId('body').parentElement?.className).toContain('min-w-0');
  });
});

describe('StatusBadge', () => {
  it.each([
    ['ACTIVE', 'success'],
    ['PENDING', 'warning'],
    ['REJECTED', 'danger'],
    ['CLOSED', 'neutral'],
  ])('maps %s to the %s tone', (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });

  it('reads compound statuses by segment, not by substring', () => {
    expect(statusTone('IN_MODERATION')).toBe('warning');
    expect(statusTone('PENDING_VERIFICATION')).toBe('warning');
    expect(statusTone('CHALLENGE_WINNER')).toBe('success');
  });

  it('leaves an unknown status neutral rather than guessing', () => {
    expect(statusTone('SOMETHING_NEW')).toBe('neutral');
  });

  it('humanises the label', () => {
    render(<StatusBadge status="IN_MODERATION" />);
    expect(screen.getByText('in moderation')).toBeInTheDocument();
  });
});

describe('FilterChips', () => {
  function Harness() {
    const [value, setValue] = useState('all');
    return (
      <FilterChips
        label="Filter notifications"
        value={value}
        onChange={setValue}
        options={[
          { value: 'all', label: 'All' },
          { value: 'unread', label: 'Unread', count: 3 },
        ]}
      />
    );
  }

  it('is a labelled group of toggles, not an unimplemented tablist', () => {
    render(<Harness />);

    const group = screen.getByRole('group', { name: 'Filter notifications' });
    expect(within(group).queryAllByRole('tab')).toHaveLength(0);
    expect(within(group).getAllByRole('button')).toHaveLength(2);
  });

  it('reports the current filter with aria-pressed', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByRole('button', { name: /All/ })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: /Unread/ }));

    expect(screen.getByRole('button', { name: /Unread/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /All/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('is reachable and operable from the keyboard alone', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.tab();
    expect(screen.getByRole('button', { name: /All/ })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: /Unread/ })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: /Unread/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('gives every chip the same height as a small button', () => {
    render(<Harness />);
    for (const chip of screen.getAllByRole('button')) {
      expect(chip.className).toContain('h-9');
    }
  });
});

describe('ConfirmDialog', () => {
  it('renders nothing until it is opened', () => {
    render(
      <ConfirmDialog
        open={false}
        title="Close the poll"
        confirmLabel="Close it"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks before an irreversible action and reports the choice', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        destructive
        title="Evict the contestant"
        description="This cannot be undone."
        confirmLabel="Evict"
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Evict the contestant');
    await user.click(screen.getByRole('button', { name: 'Evict' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('blocks confirmation while the request is in flight but keeps cancel reachable', () => {
    render(
      <ConfirmDialog
        open
        pending
        title="Resolve"
        confirmLabel="Resolve"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Resolve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Resolve' })).toHaveAttribute('aria-busy', 'true');
  });

  it('refuses to confirm when the action is not yet valid', () => {
    render(
      <ConfirmDialog
        open
        disabled
        title="Award"
        confirmLabel="Award"
        onConfirm={() => {}}
        onClose={() => {}}
      >
        <p>Pick a winner first.</p>
      </ConfirmDialog>,
    );

    expect(screen.getByRole('button', { name: 'Award' })).toBeDisabled();
    expect(screen.getByText('Pick a winner first.')).toBeInTheDocument();
  });
});

describe('the three data states', () => {
  it('announces loading politely without reading out empty boxes', () => {
    render(<LoadingState rows={3} />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(within(status).getByText('Loading…')).toBeInTheDocument();
  });

  it('reports a failure as an alert and offers a retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('omits the retry button when there is nothing to retry', () => {
    render(<ErrorState />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('explains an empty surface and can offer a way out of it', () => {
    render(
      <EmptyState
        title="No polls are live"
        description="They open when the episode starts."
        action={<Button>See past results</Button>}
      />,
    );

    expect(screen.getByText('No polls are live')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'See past results' })).toBeInTheDocument();
  });
});

describe('Button', () => {
  it('marks itself busy and refuses further clicks while loading', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Submit
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Submit' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
