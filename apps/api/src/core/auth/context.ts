import type { Role, UserStatus } from '@reality/shared';

import type { PermissionKey } from '../permissions.js';

/** The authenticated principal attached to a request by the `authenticate` guard. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
  permissions: PermissionKey[];
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Present only after the `authenticate` guard has run. */
    auth?: AuthContext;
  }
}
