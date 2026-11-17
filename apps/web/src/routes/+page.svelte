<script lang="ts">
  import Logo from '#lib/marketing/Logo.svelte';
  import Wordmark from '#lib/marketing/Wordmark.svelte';
  import Crest from '#lib/components/Crest.svelte';

  /** Real screenshots of the demo team (scripts/landing-shots.mjs), light and dark. */
  type Shot = {
    src: string;
    dark?: boolean;
    w: number;
    h: number;
    alt: string;
    /** Also ships `<src>-480.webp` for small screens. */
    small?: boolean;
  };
  const PHONE = { w: 640, h: 1073 };
  const DESK = { w: 1440, h: 900 };
  const shot = (name: string, size: { w: number; h: number }, alt: string, dark = true): Shot => ({
    src: `/landing/${name}`,
    dark,
    ...size,
    alt,
  });

  const rows: {
    k: string;
    eyebrow: string;
    title: string;
    body: string;
    points: string[];
    main: Shot;
    side?: Shot;
    phoneMain?: boolean;
  }[] = [
    {
      k: 'avail',
      eyebrow: 'Schedule and availability',
      title: "Know who's in before you pick the team",
      body: 'Games, practices, socials and fundraisers in one schedule. Players reply in one tap; you see the squad by position, with front-row cover warnings.',
      points: [
        'Weekly practices with an end date, editable as a whole series',
        'Nudge the players who haven’t replied, straight from the board',
        'A team calendar everyone can add to their phone',
      ],
      main: shot(
        'desktop-availability',
        DESK,
        'An upcoming game with the availability board: who is in, maybe and out, grouped by position.',
      ),
    },
    {
      k: 'sheet',
      eyebrow: 'Team sheets',
      title: 'Pick the side in minutes. Share it in seconds.',
      body: 'Drag players onto the pitch on a laptop or tap to pick on a phone. Out-of-position and front-row warnings keep you honest, and one tap turns it into an image for the group chat.',
      points: [
        'Drafts stay with the coaches until you publish',
        'Starters, replacements, captain and vice-captain',
        'Story, square and landscape images in your team colours',
      ],
      main: shot(
        'desktop-sheet',
        DESK,
        'The team sheet builder: a pitch with the starting fifteen and the squad list beside it.',
      ),
      side: {
        ...shot(
          'sheet-story',
          { w: 540, h: 960 },
          'An exported team sheet image ready to share.',
          false,
        ),
      },
    },
    {
      k: 'play',
      eyebrow: 'Plays and drills',
      title: 'Plays that move. Drills everyone understands.',
      body: 'Draw lineouts, scrum moves and strike plays frame by frame, or start from a preset. Players watch them on their phones and you can see who has.',
      points: [
        'Lineout, scrum, restart, pod and defensive presets for 15s and 7s',
        'A starter drill library with diagrams and coaching points',
        'Export as images or video',
      ],
      main: shot(
        'desktop-play',
        DESK,
        'The play designer with a lineout on the pitch and the frame strip below.',
      ),
      side: shot('phone-play', PHONE, 'A play on a phone, ready to watch.'),
    },
    {
      k: 'practice',
      eyebrow: 'Practice',
      title: 'Plan the session. Run it with your assistants.',
      body: 'Build a practice from the drill library, split forwards and backs, and see contact and intensity minutes add up. At the field, every coach follows the same live timer on their own phone.',
      points: [
        'Each group gets its own countdown and drill diagram',
        'Water breaks, stations and rotations',
        'Captains can see the plan if you let them',
      ],
      main: shot(
        'desktop-practice',
        DESK,
        'The practice planner with a drill library and a timeline split into forwards and backs.',
      ),
      side: shot(
        'phone-live',
        PHONE,
        'A live practice on a phone: a countdown with forwards and backs on different drills.',
      ),
    },
    {
      k: 'kit',
      eyebrow: 'Kit and equipment',
      title: 'Know where every ball and bib is.',
      body: 'Log the club’s kit once, then see who has the match balls, the first-aid bag and the bibs. Players hand kit to a teammate in the app, and the teammate accepts before it moves.',
      points: [
        'Flags kit at risk when the person holding it says they can’t make it',
        'A match-day checklist of what has to be there',
        'Full history for every item: who had it, when, and its condition',
      ],
      main: shot(
        'desktop-kit',
        DESK,
        'The kit list: balls, shields, bibs and the first-aid kit, with who has each one.',
      ),
      side: shot(
        'phone-kit',
        PHONE,
        'A set of bibs on a phone, with a handover to a teammate waiting for an answer.',
      ),
    },
    {
      k: 'match',
      eyebrow: 'Match day',
      title: 'The whole game, recorded with one thumb.',
      body: 'Game clock, tries, kicks, cards, sin bins and replacements, with big buttons that work with no signal. When the whistle goes you get a match report worth sharing.',
      points: [
        'Sin-bin timers that pause with the clock',
        'Minutes played and score progression for everyone',
        'Tournament days for 7s',
      ],
      main: shot(
        'phone-match',
        PHONE,
        'The sideline recorder at full time: the score, the clock and large buttons for scores, cards and subs.',
      ),
      side: shot('phone-summary', PHONE, 'The match summary with the score progression chart.'),
      phoneMain: true,
    },
  ];

  const extras = [
    {
      t: 'Roles that fit your club',
      b: 'Owner, admins for the e-board, coaches, managers and players, plus your own roles like captain or social secretary.',
    },
    {
      t: 'Hand over when the e-board changes',
      b: 'Pass ownership to the new president in two taps. Nothing is lost when people move on.',
    },
    {
      t: 'Your colours, your crest',
      b: 'Upload your club emblem and it shows up in the app and on every shared image.',
    },
    {
      t: 'You choose what players see',
      b: "Just the numbers, or who's going to games or everything. Reasons for missing a session stay with staff.",
    },
  ];
</script>

<svelte:head>
  <title>Phaseplay: run your rugby team from one app</title>
  <meta
    name="description"
    content="Schedule and availability, team sheets, animated plays and drills, practice plans with a live session timer, and a sideline match recorder for rugby 15s and 7s."
  />
  <meta property="og:title" content="Phaseplay" />
  <meta property="og:description" content="Run your rugby team from one app." />
  <link rel="canonical" href="https://phaseplay.app/" />
  <link
    rel="preload"
    as="image"
    href="/landing/phone-home-480.webp"
    imagesrcset="/landing/phone-home-480.webp 480w, /landing/phone-home.webp 640w"
    imagesizes="(max-width: 959px) 260px, 320px"
    type="image/webp"
    fetchpriority="high"
    media="(prefers-color-scheme: light)"
  />
</svelte:head>

{#snippet picture(s: Shot, cls: string, eager = false)}
  {@const darkSet = s.small
    ? `${s.src}-dark-480.webp 480w, ${s.src}-dark.webp 640w`
    : `${s.src}-dark.webp`}
  {@const lightSet = s.small ? `${s.src}-480.webp 480w, ${s.src}.webp 640w` : undefined}
  <picture class={cls}>
    {#if s.dark}
      {#if eager}
        <source
          srcset={darkSet}
          sizes={s.small ? '(max-width: 959px) 260px, 320px' : undefined}
          media="(prefers-color-scheme: dark)"
          type="image/webp"
        />
      {:else}
        <source
          data-defer
          data-srcset={darkSet}
          media="(prefers-color-scheme: dark)"
          type="image/webp"
        />
      {/if}
    {/if}
    {#if eager}
      <img
        src="{s.src}.webp"
        srcset={lightSet}
        sizes={s.small ? '(max-width: 959px) 260px, 320px' : undefined}
        width={s.w}
        height={s.h}
        alt={s.alt}
        decoding="auto"
        fetchpriority="high"
      />
    {:else}
      <!-- Filled in after the page loads (app.html), so these never compete with the hero. -->
      <img
        data-defer
        data-src="{s.src}.webp"
        width={s.w}
        height={s.h}
        alt={s.alt}
        decoding="async"
      />
      <noscript><img src="{s.src}.webp" width={s.w} height={s.h} alt={s.alt} /></noscript>
    {/if}
  </picture>
{/snippet}

<div class="landing">
  <header class="top">
    <a class="brand" href="/" aria-label="Phaseplay home"
      ><Logo size={36} /><Wordmark size="1.0625rem" /></a
    >
    <nav aria-label="Account">
      <a class="link" href="/signin">Sign in</a>
      <a class="cta sm" href="/signup">Get started</a>
    </nav>
  </header>

  <main>
    <section class="hero">
      <div class="copy">
        <p class="eyebrow">For rugby coaches and clubs · 15s and 7s</p>
        <h1>Run your rugby team<br /><span>from one app.</span></h1>
        <p class="lede">
          Who's available, who's playing, what the plays are and what happened on the day. Quick on
          a phone at the field, roomy on a laptop at home.
        </p>
        <div class="actions">
          <a class="cta" href="/signup">Create your team</a>
          <a class="ghost" href="/demo">Explore the demo</a>
        </div>
        <p class="fine">
          Look around a demo team with no account. When you're ready, sign up with just your name
          and a passkey: no email, no password.
        </p>
      </div>
      <div class="visual">
        <div class="device phone hero-phone">
          {@render picture(
            {
              ...shot(
                'phone-home',
                PHONE,
                'The Phaseplay home screen: the next practice with replies, and who is in by position.',
              ),
              small: true,
            },
            'screen',
            true,
          )}
        </div>
      </div>
    </section>

    <nav class="jump" aria-label="Features">
      {#each rows as r (r.k)}<a href="#{r.k}">{r.eyebrow}</a>{/each}
    </nav>

    {#each rows as r, i (r.k)}
      <section class="row" class:flip={i % 2 === 1} id={r.k} aria-labelledby="{r.k}-h">
        <div class="text">
          <p class="eyebrow">{r.eyebrow}</p>
          <h2 id="{r.k}-h">{r.title}</h2>
          <p class="body">{r.body}</p>
          <ul class="ticks">
            {#each r.points as p (p)}<li>{p}</li>{/each}
          </ul>
        </div>
        <div class="art" class:phones={r.phoneMain}>
          {#if r.phoneMain}
            <div class="device phone">{@render picture(r.main, 'screen')}</div>
            {#if r.side}<div class="device phone second">
                {@render picture(r.side, 'screen')}
              </div>{/if}
          {:else}
            <div class="device browser">
              <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
              {@render picture(r.main, 'screen')}
            </div>
            {#if r.side}
              <div class="device phone overlay" class:story={r.k === 'sheet'}>
                {@render picture(r.side, 'screen')}
              </div>
            {/if}
          {/if}
        </div>
      </section>
    {/each}

    <section class="club" aria-labelledby="club-h">
      <h2 id="club-h">Built for the whole club, not just the coach</h2>
      <ul>
        {#each extras as x (x.t)}
          <li>
            <h3>{x.t}</h3>
            <p>{x.b}</p>
          </li>
        {/each}
      </ul>
    </section>

    <section class="promise">
      <img
        class="crest"
        src="/brand/phaseplay-logo-mono-chalk.svg"
        alt=""
        width="108"
        height="120"
        loading="lazy"
      />
      <div>
        <h2>Made for the touchline</h2>
        <p>
          No ads, no trackers, no feeds. It opens instantly from your home screen and keeps working
          with no signal at the ground.
        </p>
      </div>
      <ul class="ticks">
        <li>Installs like an app on iPhone and Android</li>
        <li>Works offline; syncs when you're back in range</li>
        <li>Passkeys instead of passwords</li>
        <li>Light and dark mode</li>
      </ul>
    </section>

    <section class="demo" aria-labelledby="demo-h">
      <Crest
        colors={{ primary: '#1f6f43', secondary: '#f2c230' }}
        text="PRFC"
        size={64}
        label="Phaseplay RFC crest"
      />
      <div class="grow">
        <p class="eyebrow">Live demo</p>
        <h2 id="demo-h">Spend a week with Phaseplay RFC.</h2>
        <p class="muted">
          A demo squad of 30 with practices, games, a 7s tournament, a fundraiser, team sheets,
          plays and a recorded match. Look around as their coach. Nothing you do is saved.
        </p>
      </div>
      <a class="cta" href="/demo">Explore the demo</a>
    </section>
  </main>

  <footer>
    <span>© {new Date().getFullYear()} Phaseplay</span>
    <a href="/privacy">Privacy</a>
  </footer>
</div>

<style>
  .landing {
    --maxw: 1160px;
    --green: var(--brand-pitch);
    min-height: 100dvh;
    background:
      radial-gradient(
        1200px 600px at 80% -10%,
        color-mix(in srgb, var(--brand-pitch) 14%, transparent),
        transparent 60%
      ),
      radial-gradient(
        700px 500px at -10% 20%,
        color-mix(in srgb, var(--brand-amber) 10%, transparent),
        transparent 60%
      ),
      var(--bg);
  }
  .top {
    max-width: var(--maxw);
    margin: 0 auto;
    padding: calc(var(--safe-t) + var(--s-4)) var(--s-4) var(--s-4);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    font-weight: 800;
    font-size: 1.125rem;
    letter-spacing: -0.02em;
    color: var(--text);
    text-decoration: none;
  }
  nav {
    display: flex;
    gap: var(--s-2);
    align-items: center;
  }
  .brand :global(svg) {
    flex: none;
  }
  nav a {
    white-space: nowrap;
  }
  .top {
    gap: var(--s-3);
  }
  .brand {
    min-width: 0;
  }
  @media (max-width: 560px) {
    .brand :global(.wordmark) {
      font-size: 0.8125rem !important;
    }
    .link {
      padding: 10px 6px;
    }
  }
  @media (max-width: 400px) {
    .brand :global(.wordmark) {
      display: none;
    }
  }
  .link {
    color: var(--text);
    font-weight: 600;
    text-decoration: none;
    padding: 10px 12px;
    border-radius: var(--r-md);
  }
  .cta,
  .ghost {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 52px;
    padding: 0 var(--s-6);
    border-radius: var(--r-md);
    font-weight: 700;
    text-decoration: none;
  }
  .cta {
    background: var(--green);
    color: #fff;
    box-shadow: 0 6px 20px rgb(30 122 85 / 0.3);
  }
  .cta.sm {
    min-height: 40px;
    padding: 0 var(--s-4);
    box-shadow: none;
  }
  .ghost {
    color: var(--text);
    border: 1px solid var(--border-strong);
    background: var(--surface);
  }
  main {
    max-width: var(--maxw);
    margin: 0 auto;
    padding: 0 var(--s-4);
  }
  .eyebrow {
    margin: 0;
    font-size: var(--t-14);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--green);
  }
  :global(:root[data-theme='dark']) .eyebrow,
  :global(:root[data-theme='dark']) h1 span {
    color: #6fd39a;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .eyebrow,
    :global(:root:not([data-theme='light'])) h1 span {
      color: #6fd39a;
    }
  }

  /* Hero */
  .hero {
    display: grid;
    gap: var(--s-10);
    padding: var(--s-8) 0 var(--s-12);
    align-items: center;
  }
  h1 {
    font-size: clamp(2.4rem, 7vw, 4.2rem);
    line-height: 1.02;
    letter-spacing: -0.035em;
    font-weight: 800;
    margin: var(--s-3) 0 var(--s-5);
  }
  h1 span {
    color: var(--green);
  }
  .lede {
    font-size: 1.1875rem;
    color: var(--text-2);
    max-width: 34rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-3);
    margin: var(--s-8) 0 var(--s-3);
  }
  .fine {
    font-size: var(--t-14);
    color: var(--text-3);
  }
  .visual {
    position: relative;
    width: min(100%, 260px);
    margin: 0 auto;
  }

  /* Device frames */
  .device {
    position: relative;
    overflow: hidden;
    background: #0e1511;
    box-shadow:
      0 30px 60px -20px rgb(10 30 18 / 0.35),
      0 10px 24px -12px rgb(10 30 18 / 0.3);
  }
  /* Reserve the space (width/height ratio) but show nothing until the deferred source is set. */
  .device :global(img[data-defer]:not([src])) {
    visibility: hidden;
  }
  .device :global(img) {
    display: block;
    width: 100%;
    height: auto;
  }
  .phone {
    border-radius: 38px;
    padding: 9px;
  }
  .phone :global(picture),
  .phone :global(img) {
    border-radius: 30px;
    overflow: hidden;
  }
  .browser {
    border-radius: 14px;
    padding: 28px 0 0;
    border: 1px solid var(--border);
    background: var(--surface-2, #e9eee9);
  }
  .browser .dots {
    position: absolute;
    top: 10px;
    left: 12px;
    display: flex;
    gap: 6px;
  }
  .browser .dots i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--border-strong);
  }

  /* Jump links */
  .jump {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--s-2);
    padding-bottom: var(--s-6);
  }
  .jump a {
    padding: 8px 14px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
    font-size: var(--t-14);
    text-decoration: none;
  }

  /* Feature rows */
  .row {
    display: grid;
    gap: var(--s-8);
    align-items: center;
    padding: var(--s-12) 0;
    scroll-margin-top: var(--s-6);
  }
  .row h2,
  .club h2,
  .promise h2 {
    font-size: clamp(1.6rem, 4vw, 2.4rem);
    line-height: 1.1;
    letter-spacing: -0.03em;
    margin: var(--s-2) 0 var(--s-4);
    max-width: 22ch;
  }
  .body {
    font-size: 1.0625rem;
    color: var(--text-2);
    max-width: 46ch;
  }
  .art {
    position: relative;
    min-width: 0;
  }
  .art .overlay {
    position: absolute;
    right: -8px;
    bottom: -32px;
    width: 30%;
    max-width: 190px;
    border-radius: 26px;
    padding: 6px;
  }
  .art .overlay :global(picture),
  .art .overlay :global(img) {
    border-radius: 21px;
  }
  .art .overlay.story {
    border-radius: 18px;
  }
  .art .overlay.story :global(picture),
  .art .overlay.story :global(img) {
    border-radius: 13px;
  }
  .art.phones {
    display: flex;
    justify-content: center;
    gap: var(--s-5);
  }
  .art.phones .phone {
    width: min(46%, 270px);
  }
  .art.phones .second {
    margin-top: var(--s-12);
  }
  .ticks {
    list-style: none;
    padding: 0;
    margin: var(--s-5) 0 0;
    display: grid;
    gap: var(--s-3);
    align-content: center;
  }
  .ticks li {
    position: relative;
    padding-left: 30px;
    font-weight: 600;
  }
  .ticks li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #2f8a52
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E")
      center / 12px no-repeat;
  }

  /* Club cards */
  .club {
    padding: var(--s-12) 0;
  }
  .club ul {
    list-style: none;
    padding: 0;
    margin: var(--s-6) 0 0;
    display: grid;
    gap: var(--s-4);
  }
  .club li {
    padding: var(--s-6);
    border-radius: var(--r-lg);
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .club h3 {
    font-size: 1.125rem;
    margin: 0 0 var(--s-2);
  }
  .club p {
    margin: 0;
    color: var(--text-2);
    font-size: 0.9375rem;
  }

  .promise {
    display: grid;
    gap: var(--s-6);
    padding: var(--s-10);
    border-radius: 24px;
    background: var(--brand-ink);
    color: var(--brand-chalk);
  }
  .promise h2 {
    margin-top: 0;
  }
  .promise .crest {
    width: 72px;
    height: auto;
  }
  .promise p {
    color: #b9d2c1;
    margin-top: var(--s-3);
    max-width: 46ch;
  }
  .demo {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-5);
    align-items: center;
    margin: var(--s-12) 0;
    padding: var(--s-6);
    border-radius: var(--r-lg);
    border: 1px solid var(--border-strong);
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--brand-pitch) 8%, var(--surface)),
      var(--surface)
    );
  }
  .demo .grow {
    flex: 1 1 280px;
  }
  .demo h2 {
    font-size: var(--t-24);
    margin: var(--s-1) 0 var(--s-2);
  }
  footer {
    max-width: var(--maxw);
    margin: 0 auto;
    padding: var(--s-6) var(--s-4) calc(var(--safe-b) + var(--s-8));
    display: flex;
    gap: var(--s-4);
    color: var(--text-3);
    font-size: var(--t-14);
  }
  footer a {
    color: var(--text-2);
  }
  @media (min-width: 640px) {
    .club ul {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
  @media (min-width: 960px) {
    .hero {
      grid-template-columns: 1.15fr minmax(0, 1fr);
      padding: var(--s-12) 0 var(--s-16);
    }
    .visual {
      width: 320px;
    }
    .row {
      grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
      gap: var(--s-12);
    }
    .row.flip .text {
      order: 2;
    }
    .club ul {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .promise {
      grid-template-columns: auto 1.2fr minmax(0, 1fr);
      align-items: center;
      padding: var(--s-12);
    }
  }
</style>
