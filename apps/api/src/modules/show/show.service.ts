import { notFound } from '../../core/errors.js';
import { prisma } from '../../core/prisma.js';

/**
 * "The show" is a singleton from the audience's point of view: there is one
 * live production at a time. Every feature module resolves its show through
 * here rather than taking a showId from the client, which is also why a client
 * cannot address someone else's show by guessing an id.
 */
export async function getCurrentShowId(): Promise<string> {
  const show = await prisma.show.findFirst({
    where: { deletedAt: null, status: { in: ['LIVE', 'PAUSED', 'UPCOMING'] } },
    orderBy: [{ status: 'asc' }, { startsAt: 'desc' }],
    select: { id: true },
  });

  if (!show) throw notFound('No active show is configured');
  return show.id;
}

export interface LiveState {
  show: {
    id: string;
    name: string;
    tagline: string | null;
    status: string;
    currencySymbol: string;
  };
  episode: {
    id: string;
    number: number;
    title: string;
    airsAt: string;
    status: string;
    isLive: boolean;
  } | null;
  currentEvent: {
    id: string;
    type: string;
    title: string;
    description: string | null;
    occurredAt: string;
  } | null;
  isLive: boolean;
  serverTime: string;
}

export async function getLiveState(): Promise<LiveState> {
  const show = await prisma.show.findFirst({
    where: { deletedAt: null, status: { in: ['LIVE', 'PAUSED', 'UPCOMING'] } },
    orderBy: [{ status: 'asc' }, { startsAt: 'desc' }],
  });

  if (!show) throw notFound('No active show is configured');

  const episode =
    (await prisma.episode.findFirst({
      where: { showId: show.id, isLive: true },
      orderBy: { airsAt: 'desc' },
    })) ??
    (await prisma.episode.findFirst({
      where: { showId: show.id, status: { in: ['SCHEDULED', 'LIVE'] } },
      orderBy: { airsAt: 'asc' },
    }));

  const currentEvent = episode
    ? await prisma.event.findFirst({
        where: { episodeId: episode.id },
        orderBy: { occurredAt: 'desc' },
      })
    : null;

  return {
    show: {
      id: show.id,
      name: show.name,
      tagline: show.tagline,
      status: show.status,
      currencySymbol: show.currencySymbol,
    },
    episode: episode
      ? {
          id: episode.id,
          number: episode.number,
          title: episode.title,
          airsAt: episode.airsAt.toISOString(),
          status: episode.status,
          isLive: episode.isLive,
        }
      : null,
    currentEvent: currentEvent
      ? {
          id: currentEvent.id,
          type: currentEvent.type,
          title: currentEvent.title,
          description: currentEvent.description,
          occurredAt: currentEvent.occurredAt.toISOString(),
        }
      : null,
    isLive: show.status === 'LIVE' && Boolean(episode?.isLive),
    // Clients use this to correct for clock skew when rendering countdowns.
    serverTime: new Date().toISOString(),
  };
}

export async function listEpisodes(showId: string, limit = 20) {
  const episodes = await prisma.episode.findMany({
    where: { showId },
    orderBy: { number: 'desc' },
    take: limit,
  });

  return episodes.map((episode) => ({
    id: episode.id,
    number: episode.number,
    title: episode.title,
    synopsis: episode.synopsis,
    airsAt: episode.airsAt.toISOString(),
    status: episode.status,
    isLive: episode.isLive,
  }));
}

export async function listRecentEvents(showId: string, limit = 20) {
  const events = await prisma.event.findMany({
    where: { showId },
    orderBy: { occurredAt: 'desc' },
    take: limit,
    include: {
      contestants: {
        include: { contestant: { select: { id: true, displayName: true, avatarUrl: true } } },
      },
    },
  });

  return events.map((event) => ({
    id: event.id,
    type: event.type,
    title: event.title,
    description: event.description,
    occurredAt: event.occurredAt.toISOString(),
    isMajor: event.isMajor,
    contestants: event.contestants.map((link) => link.contestant),
  }));
}
