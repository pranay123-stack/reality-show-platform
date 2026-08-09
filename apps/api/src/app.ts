import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';

import { getConfig } from './core/config.js';
import { registerErrorHandler } from './core/errors.js';
import { buildLoggerOptions } from './core/logger.js';
import { registerCorePlugins } from './core/plugins.js';
import { registerModules } from './modules/index.js';

export interface BuildAppOptions {
  /**
   * Skips the global rate limiter. Security headers, CORS and cookie parsing
   * are still registered, because auth flows depend on them.
   */
  minimal?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = getConfig();

  const app = Fastify({
    logger: buildLoggerOptions(),
    genReqId: () => randomUUID(),
    trustProxy: config.isProduction,
    bodyLimit: 1_048_576, // 1 MiB — no endpoint accepts large payloads
    ajv: { customOptions: { removeAdditional: 'all', coerceTypes: false } },
  });

  await registerCorePlugins(app, { rateLimit: !options.minimal });

  registerErrorHandler(app);
  await registerModules(app);

  return app;
}
