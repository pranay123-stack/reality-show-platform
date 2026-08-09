import type { Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';

import { hashIp } from '../../core/hashing.js';
import { prisma } from '../../core/prisma.js';

/**
 * Audit trail for operator actions.
 *
 * Every sensitive mutation writes one row. The trail is append-only and is
 * never exposed to ordinary users — `audit.view` gates reading it.
 *
 * Writing an audit row must not be able to fail the action it describes, so
 * errors are logged and swallowed; a lost audit line is bad, but a producer
 * unable to close a poll during a live show is worse.
 */
export interface AuditOptions {
  before?: unknown;
  after?: unknown;
}

export async function writeAudit(
  request: FastifyRequest,
  action: string,
  entityType: string,
  entityId?: string | null,
  options: AuditOptions = {},
): Promise<void> {
  const auth = request.auth;

  try {
    await prisma.auditLog.create({
      data: {
        actorId: auth?.userId ?? null,
        actorRole: auth?.role ?? null,
        action,
        entityType,
        entityId: entityId ?? null,
        ...(options.before !== undefined
          ? { before: options.before as Prisma.InputJsonValue }
          : {}),
        ...(options.after !== undefined ? { after: options.after as Prisma.InputJsonValue } : {}),
        ipHash: hashIp(request.ip),
        userAgent: request.headers['user-agent']?.slice(0, 400) ?? null,
        requestId: request.id,
      },
    });

    if (auth?.userId) {
      await prisma.adminAction.create({
        data: {
          actorId: auth.userId,
          action,
          entityType,
          entityId: entityId ?? null,
          ...(options.after !== undefined
            ? { payload: options.after as Prisma.InputJsonValue }
            : {}),
        },
      });
    }
  } catch (error) {
    request.log.error({ err: error, action, entityType, entityId }, 'failed to write audit log');
  }
}

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  cursor?: string;
  limit?: number;
}

export async function listAuditLogs(query: AuditQuery = {}) {
  const limit = Math.min(query.limit ?? 50, 200);

  const rows = await prisma.auditLog.findMany({
    where: {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: { contains: query.action } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include: { actor: { select: { id: true, email: true, role: true } } },
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: items.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actor: row.actor ? { id: row.actor.id, email: row.actor.email, role: row.actor.role } : null,
      actorRole: row.actorRole,
      before: row.before,
      after: row.after,
      requestId: row.requestId,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    hasMore,
  };
}
