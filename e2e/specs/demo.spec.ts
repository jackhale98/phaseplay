import { test, expect } from '../fixtures';

test('anyone can explore the demo team from the landing page without an account', async ({ page, axe }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Explore the demo' }).first().click();
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByRole('complementary', { name: 'Demo' })).toContainText("You're exploring the demo team");
  await expect(page.getByRole('main').getByText('Phaseplay RFC').first()).toBeVisible();
  await axe(page);

  // Changes apply on this device only; the server never receives them.
  const writes: string[] = [];
  page.on('request', (r) => r.method() !== 'GET' && r.url().includes('/rsvps/') && writes.push(r.url()));
  const group = page.getByRole('group', { name: 'Are you in?' }).first();
  const maybe = group.getByRole('button', { name: 'Maybe' });
  await maybe.click();
  await expect(maybe).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status').getByText('changes stay on this device', { exact: false })).toBeVisible();
  expect(writes).toEqual([]);

  // Leaving the demo goes to sign-up with nothing left behind.
  await page.getByRole('button', { name: 'Create your team' }).click();
  await expect(page).toHaveURL(/\/signup/);
  const me = await page.request.get('/api/v1/me');
  expect(me.status()).toBe(401);
});

test('the sign-in page offers the demo too', async ({ page }) => {
  await page.goto('/signin');
  await page.getByRole('link', { name: 'Explore the demo team' }).click();
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByRole('complementary', { name: 'Demo' })).toBeVisible();
});

test('phaseplay.app/demo is a shareable link straight into the demo', async ({ page }) => {
  await page.goto('/demo');
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByRole('complementary', { name: 'Demo' })).toBeVisible();
});
