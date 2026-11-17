import type { Member, Perms } from '@phaseplay/shared';

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  RL_AUTH?: RateLimit;
  ENV: 'production' | 'development' | 'test';
  RP_ID: string;
  ORIGINS: string;
  VERSION: string;
  /** Worker secret: encrypts the stored VAPID private key (lib/push/vapid.ts). Optional. */
  PUSH_KEY_SECRET?: string;
};

export type SessionUser = {
  id: string;
  displayName: string;
  sessionHash: string;
  expiresAt: number;
};

export type Vars = {
  db: D1Database;
  queries: { n: number };
  user: SessionUser | null;
  member: Member;
  /** The member's base role plus permissions from their team roles (set by requireMember). */
  perms: Perms;
  /** Latest change to any of the member's team roles (a change can widen what they may see). */
  rolesUpdatedAt: number;
  requestId: string;
};

export type AppEnv = { Bindings: Env; Variables: Vars };

declare global {
  const __TEST_AUTH__: boolean;
}
