import { test, expect } from '@playwright/test';

test('production: landing renders with no console errors and the API is reachable', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const health = await request.get('/api/health');
  expect(health.ok()).toBeTruthy();
  expect((await health.json()).env).toBe('production');
  // Test-only auth must not exist in production.
  const t = await request.post('/api/v1/test/login', {
    data: {},
    headers: { origin: 'https://phaseplay.app' },
  });
  expect(t.status()).toBe(404);
  // Deep links get the SPA shell with security headers.
  const deep = await request.get('/events/does-not-exist');
  expect(deep.status()).toBe(200);
  expect(deep.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(errors).toEqual([]);
});
