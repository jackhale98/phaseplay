import { test, expect, openTeam } from '../fixtures';

test('landing renders, is accessible and has no console errors', async ({ page, axe }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('one calm place');
  await axe(page);
  expect(errors).toEqual([]);
});

test('signed-in owner lands on Home for a new team', async ({ page, team, axe }) => {
  await openTeam(page, team.teamId, '/home');
  await expect(page.getByRole('heading', { name: /Evening|Morning|Afternoon/ })).toBeVisible();
  await expect(page.getByText('Add your first training')).toBeVisible();
  await axe(page);
});

test('RSVP from Home is one tap and survives a reload', async ({ page, team }) => {
  const id = crypto.randomUUID();
  await team.post(`/teams/${team.teamId}/events`, { id, type: 'training', title: 'Training', startsAt: Date.now() + 2 * 86400e3 });
  await openTeam(page, team.teamId, '/home');
  const inBtn = page.getByRole('group', { name: 'Are you in?' }).first().getByRole('button', { name: 'In' });
  await inBtn.click();
  await expect(inBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('All changes saved').first()).toBeAttached();
  await page.reload();
  await expect(page.getByRole('group', { name: 'Are you in?' }).first().getByRole('button', { name: 'In' })).toHaveAttribute('aria-pressed', 'true');
});
