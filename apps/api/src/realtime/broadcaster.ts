import type { Namespace } from 'socket.io';

import { getConfig } from '../core/config.js';
import { rooms, type PollOptionCount } from './events.js';

/**
 * Coalesced poll broadcasting.
 *
 * Emitting on every vote makes broadcast volume equal vote volume: 10 000
 * voters in ten seconds would mean 10 000 fan-outs to 10 000 sockets. Instead
 * each poll gets at most one frame per tick (250 ms by default), carrying the
 * latest counts. Broadcast cost then depends on the number of *polls*, not the
 * number of votes.
 *
 * The trade is up to one tick of staleness on screen, which is invisible next
 * to network latency and far cheaper than the alternative.
 */

interface PendingFrame {
  counts: PollOptionCount[];
  totalVotes: number;
  version: number;
}

export class PollBroadcaster {
  private pending = new Map<string, PendingFrame>();
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;

  // Deliberately a Namespace, not the Server: sockets join their rooms inside
  // `/live`, and `Server.to()` would address the default namespace instead —
  // a silent no-op that looks exactly like a working broadcast.
  constructor(private readonly namespace: Namespace) {
    this.intervalMs = getConfig().POLL_BROADCAST_THROTTLE_MS;
  }

  /** Queues the latest state for a poll. Later calls overwrite earlier ones. */
  queue(pollId: string, frame: PendingFrame): void {
    const existing = this.pending.get(pollId);
    // Guard against an out-of-order write racing the flush.
    if (existing && existing.version > frame.version) return;

    this.pending.set(pollId, frame);
    this.schedule();
  }

  /** Sends immediately, bypassing the tick. Used for start/close/result. */
  flushNow(pollId: string): void {
    const frame = this.pending.get(pollId);
    if (!frame) return;
    this.pending.delete(pollId);
    this.emit(pollId, frame);
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushAll();
    }, this.intervalMs);
    // Never keep the process alive just to send a tally.
    this.timer.unref?.();
  }

  private flushAll(): void {
    const frames = [...this.pending.entries()];
    this.pending.clear();
    for (const [pollId, frame] of frames) this.emit(pollId, frame);
  }

  private emit(pollId: string, frame: PendingFrame): void {
    // Clients that have voted get the full breakdown…
    this.namespace.to(rooms.pollVoters(pollId)).emit('poll:updated', {
      pollId,
      counts: frame.counts,
      totalVotes: frame.totalVotes,
      version: frame.version,
    });

    // …everyone else gets participation volume only. Excluding the voters' room
    // keeps a voter from receiving both frames and applying the weaker one.
    this.namespace
      .to(rooms.poll(pollId))
      .except(rooms.pollVoters(pollId))
      .emit('poll:updated', {
        pollId,
        counts: null,
        totalVotes: frame.totalVotes,
        version: frame.version,
      });
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }
}
