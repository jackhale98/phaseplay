import { test, expect, openTeam } from '../fixtures';

/**
 * Real push delivery can't be tested in CI, so in Chromium PushManager is stubbed with a fake
 * subscription on a real push-service host (the test server never sends: ENV=test fakes sends).
 */
const stubPush = () => {
  const keys = {
    p256dh:
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  };
  type Fake = {
    endpoint: string;
    options: { applicationServerKey: ArrayBuffer };
    toJSON(): unknown;
    unsubscribe(): Promise<boolean>;
  };
  let sub: Fake | null = null;
  if (!('PushManager' in window)) return;
  // Headless Chromium reports notifications as denied even when granted: follow the grant.
  Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
  Notification.requestPermission = async () => 'granted';
  PushManager.prototype.subscribe = async function (opts?: PushSubscriptionOptionsInit) {
    const k = opts?.applicationServerKey as Uint8Array;
    sub = {
      endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${Math.random().toString(36).slice(2)}`,
      options: { applicationServerKey: k.slice().buffer },
      toJSON() {
        return { endpoint: this.endpoint, keys };
      },
      async unsubscribe() {
        sub = null;
        return true;
      },
    };
    return sub as unknown as PushSubscription;
  };
  PushManager.prototype.getSubscription = async function () {
    return sub as unknown as PushSubscription | null;
  };
};

test('notification settings: topics persist, and the page is accessible', async ({ team, axe }) => {
  const page = team.owner.page;
  // Playwright's desktop WebKit exposes PushManager but never answers it (no push service), which
  // no real browser does. Make "not subscribed" answer at once so the page settles.
  await page.addInitScript(() => {
    if ('PushManager' in window && !navigator.userAgent.includes('Chrome'))
      PushManager.prototype.getSubscription = () => Promise.resolve(null);
  });
  await openTeam(page, team.teamId, '/more');
  await page.getByRole('link', { name: 'Notifications' }).click();
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This device' })).toBeVisible();
  await expect(page.getByText(/No devices yet/)).toBeVisible();
  await axe(page);

  const schedule = page.getByRole('switch', { name: /Schedule changes/ });
  const kit = page.getByRole('switch', { name: /^Kit/ });
  await expect(schedule).toBeChecked();
  await schedule.click();
  await expect(schedule).not.toBeChecked();
  await expect(schedule).toBeEnabled();
  await kit.press('Space'); // keyboard works too
  await expect(kit).not.toBeChecked();
  await expect(kit).toBeEnabled();

  await page.reload();
  await expect(page.getByRole('switch', { name: /Schedule changes/ })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: /^Kit/ })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: /Team sheets/ })).toBeChecked();
  const me = await (await team.owner.api.get('/api/v1/me')).json();
  expect(me.notify).toMatchObject({ events: false, kit: false, sheets: true });
});

test('iPhone in Safari: install to the Home Screen first', async ({ team, axe }, info) => {
  test.skip(info.project.name !== 'mobile-webkit', 'iOS only');
  const page = team.owner.page;
  await openTeam(page, team.teamId, '/settings/notifications');
  await expect(
    page.getByRole('heading', { name: 'Add Phaseplay to your Home Screen first' }),
  ).toBeVisible();
  await expect(page.getByText('Add to Home Screen')).toBeVisible();
  await expect(page.getByRole('button', { name: /Turn on/ })).toHaveCount(0);
  await axe(page);
});

test('Chromium: turn on for this device, send a test, turn off', async ({
  team,
  axe,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'PushManager is stubbed in Chromium only');
  const page = team.owner.page;
  await team.owner.context.grantPermissions(['notifications']);
  await page.addInitScript(stubPush);
  await openTeam(page, team.teamId, '/settings/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications are off' })).toBeVisible();
  await page.getByRole('button', { name: 'Turn on for this device' }).click();
  await expect(page.getByRole('heading', { name: 'Notifications are on' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Devices with notifications on' }).getByText(/this device/),
  ).toBeVisible();
  await axe(page);

  await page.getByRole('button', { name: 'Send a test' }).click();
  await expect(page.getByText(/Test sent/)).toBeVisible();

  await page.getByRole('button', { name: 'Turn off on this device' }).click();
  await expect(page.getByRole('heading', { name: 'Notifications are off' })).toBeVisible();
  await expect(page.getByText(/No devices yet/)).toBeVisible();
});
