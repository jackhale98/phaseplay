import type { Member } from '@phaseplay/shared';

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  RL_AUTH?: RateLimit;
  ENV: 'production' | 'development' | 'test';
  RP_ID: string;
  ORIGINS: string;
  VERSION: string;
};

export type SessionUser = { id: string; displayName: string; sessionHash: string; expiresAt: number };

export type Vars = {
  db: D1Database;
  queries: { n: number };
  user: SessionUser | null;
  member: Member;
  requestId: string;
};

export type AppEnv = { Bindings: Env; Variables: Vars };

declare global {
  const __TEST_AUTH__: boolean;
}
