declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    TEST_MIGRATIONS: import('@cloudflare/vitest-plugin').D1Migration[];
  }
}
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ENV: 'test';
    RP_ID: string;
    ORIGINS: string;
    VERSION: string;
  }
}
