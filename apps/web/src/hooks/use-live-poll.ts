'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { queryKeys } from '@/lib/query-keys';
import { getSocket, type JoinAck, type PollSnapshot, type VoteAck } from '@/lib/socket';

export interface LivePollState {
  poll: PollSnapshot | null;
  myOptionId: string | null;
  connected: boolean;
  /** True between losing the connection and finishing the re-sync. */
  resyncing: boolean;
  isVoting: boolean;
}

/**
 * Subscribes to one live poll.
 *
 * Three rules keep the client honest:
 *
 *  1. **Never trust a stale frame.** Every update carries a monotonic `version`;
 *     anything not greater than what we already applied is dropped. Sockets can
 *     and do deliver out of order after a reconnect.
 *  2. **Re-sync, don't resume.** On reconnect the client re-joins and takes the
 *     server's snapshot wholesale rather than replaying buffered deltas.
 *  3. **Optimism only where it is safe.** The user's own selection updates
 *     immediately; aggregate counts only ever come from the server.
 */
export function useLivePoll(pollId: string | null) {
  const queryClient = useQueryClient();
  const [poll, setPoll] = useState<PollSnapshot | null>(null);
  const [myOptionId, setMyOptionId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [isVoting, setIsVoting] = useState(false);

  const appliedVersion = useRef(0);

  const applySnapshot = useCallback((snapshot: PollSnapshot, mine: string | null) => {
    appliedVersion.current = snapshot.version;
    setPoll(snapshot);
    setMyOptionId(mine);
  }, []);

  useEffect(() => {
    if (!pollId) return;

    const socket = getSocket();
    let cancelled = false;

    const join = () => {
      setResyncing(true);
      socket.emit('poll:join', { pollId }, (ack: JoinAck) => {
        if (cancelled) return;
        setResyncing(false);
        if (ack.ok && ack.poll) {
          applySnapshot(ack.poll, ack.myOptionId ?? null);
        }
      });
    };

    const onConnect = () => {
      setConnected(true);
      // Re-joining is what makes a reconnect correct: rooms are per-connection,
      // and the fresh snapshot replaces anything we might have missed.
      join();
    };

    const onDisconnect = () => {
      setConnected(false);
      setResyncing(true);
    };

    const onUpdated = (payload: {
      pollId: string;
      /** Null for spectators — the server withholds the split until you vote. */
      counts: { optionId: string; voteCount: number }[] | null;
      totalVotes: number;
      version: number;
    }) => {
      if (payload.pollId !== pollId) return;
      if (payload.version <= appliedVersion.current) return; // out-of-order frame

      appliedVersion.current = payload.version;
      setPoll((current) =>
        current
          ? {
              ...current,
              counts: payload.counts,
              totalVotes: payload.totalVotes,
              version: payload.version,
            }
          : current,
      );
    };

    const onClosed = (payload: { pollId: string; version: number }) => {
      if (payload.pollId !== pollId) return;
      setPoll((current) => (current ? { ...current, status: 'CLOSED' } : current));
      // The close frame carries no counts, so pull the final state from the server.
      join();
    };

    const onResult = (payload: {
      pollId: string;
      counts: { optionId: string; voteCount: number }[];
      totalVotes: number;
      version: number;
    }) => {
      if (payload.pollId !== pollId) return;
      appliedVersion.current = Math.max(appliedVersion.current, payload.version);
      setPoll((current) =>
        current
          ? {
              ...current,
              status: 'PUBLISHED',
              counts: payload.counts,
              totalVotes: payload.totalVotes,
            }
          : current,
      );
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('poll:updated', onUpdated);
    socket.on('poll:closed', onClosed);
    socket.on('poll:result', onResult);

    if (socket.connected) onConnect();

    return () => {
      cancelled = true;
      socket.emit('poll:leave', { pollId });
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('poll:updated', onUpdated);
      socket.off('poll:closed', onClosed);
      socket.off('poll:result', onResult);
    };
  }, [pollId, applySnapshot]);

  const vote = useCallback(
    (optionId: string) => {
      if (!pollId || isVoting) return;
      setIsVoting(true);

      // Local echo of the caller's own chip only — never of the totals.
      const previous = myOptionId;
      setMyOptionId(optionId);

      getSocket().emit('poll:vote', { pollId, optionId }, (ack: VoteAck) => {
        setIsVoting(false);

        if (!ack.ok) {
          setMyOptionId(previous);
          toast.error(ack.message ?? 'Could not record your vote');
          return;
        }

        if (ack.version !== undefined && ack.version > appliedVersion.current) {
          appliedVersion.current = ack.version;
          setPoll((current) =>
            current
              ? {
                  ...current,
                  counts: ack.counts ?? current.counts,
                  totalVotes: ack.totalVotes ?? current.totalVotes,
                  version: ack.version!,
                }
              : current,
          );
        }

        if (ack.pointsAwarded && ack.pointsAwarded > 0) {
          toast.success(`Vote counted · +${ack.pointsAwarded} points`);
          void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
          void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
        } else {
          toast.success('Vote counted');
        }
      });
    },
    [pollId, isVoting, myOptionId, queryClient],
  );

  return { poll, myOptionId, connected, resyncing, isVoting, vote } satisfies LivePollState & {
    vote: (optionId: string) => void;
  };
}
