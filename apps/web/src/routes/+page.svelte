<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Logo from '#lib/marketing/Logo.svelte';
  import HeroPitch from '#lib/marketing/HeroPitch.svelte';
  import Crest from '#lib/components/Crest.svelte';

  // Signed-in visitors (hint only; the session cookie is HttpOnly) go straight to the app.
  onMount(() => {
    try {
      if (localStorage.getItem('pp:session') === '1') void goto('/home', { replaceState: true });
    } catch {}
  });

  const features = [
    {
      t: "Who's in for Saturday?",
      b: 'One-tap RSVPs, availability by position group, and a nudge you can paste straight into the group chat.',
      k: 'avail',
    },
    {
      t: 'Team sheets in two minutes',
      b: 'Drag-and-drop on a laptop, tap-to-pick on a phone. Out-of-position and front-row cover warnings built in.',
      k: 'sheet',
    },
    {
      t: 'Plays that move',
      b: 'Draw lineouts and strike moves frame by frame. Players watch them anywhere and you see who has.',
      k: 'play',
    },
    {
      t: 'Practice, planned',
      b: 'Drill library, split forwards/backs sessions, water breaks and a full-screen session timer.',
      k: 'practice',
    },
    {
      t: 'Sideline match mode',
      b: 'Game clock, scores, cards, sin bins and subs. Big buttons, one hand, works in airplane mode.',
      k: 'match',
    },
    {
      t: 'Exports for the chat',
      b: 'Team sheets, plays and match reports as images that look great on every phone.',
      k: 'export',
    },
  ];
</script>

<svelte:head>
  <title>Phaseplay: your rugby team, one calm place</title>
  <meta
    name="description"
    content="Availability, team sheets, animated plays, practice plans and a sideline match mode for rugby coaches running 15s and 7s."
  />
  <meta property="og:title" content="Phaseplay" />
  <meta property="og:description" content="Your rugby team, one calm place." />
  <link rel="canonical" href="https://phaseplay.app/" />
</svelte:head>

<div class="landing">
  <header class="top">
    <a class="brand" href="/" aria-label="Phaseplay home"
      ><Logo size={30} /><span>Phaseplay</span></a
    >
    <nav aria-label="Account">
      <a class="link" href="/signin">Sign in</a>
      <a class="cta sm" href="/signup">Get started</a>
    </nav>
  </header>

  <main>
    <section class="hero">
      <div class="copy">
        <p class="eyebrow">For rugby coaches · 15s and 7s</p>
        <h1>Your whole season,<br /><span>one calm place.</span></h1>
        <p class="lede">
          Availability, team sheets, animated plays, practice plans and a sideline match mode. Fast
          on a phone at the pitch, roomy on a laptop at home.
        </p>
        <div class="actions">
          <a class="cta" href="/signup">Create your team</a>
          <a class="ghost" href="/demo">Explore the demo</a>
        </div>
        <p class="fine">
          Try the demo with no account. When you're ready, sign up with just your name and a
          passkey: no email, no password.
        </p>
      </div>
      <div class="visual">
        <div class="phone">
          <HeroPitch />
          <div class="float avail" aria-hidden="true">
            <strong>Who's in for Saturday?</strong>
            <div class="bars">
              <span class="y" style="width:68%"></span><span class="m" style="width:14%"
              ></span><span class="n" style="width:18%"></span>
            </div>
            <small>19 in · 4 maybe · 5 out</small>
          </div>
          <div class="float score" aria-hidden="true">
            <span class="tnum">24</span><small>v</small><span class="tnum">17</span>
            <em>Try 63′ · J. Taylor</em>
          </div>
        </div>
      </div>
    </section>

    <section class="features" aria-labelledby="f-h">
      <h2 id="f-h">Everything for the week, two taps away</h2>
      <ul>
        {#each features as f (f.k)}
          <li class="feat {f.k}">
            <span class="dot" aria-hidden="true"></span>
            <h3>{f.t}</h3>
            <p>{f.b}</p>
          </li>
        {/each}
      </ul>
    </section>

    <section class="promise">
      <div>
        <h2>Calm by design</h2>
        <p>
          No ads, no trackers, no feeds. It opens instantly from your home screen, keeps working
          without signal, and never asks for anyone's medical details.
        </p>
      </div>
      <ul class="ticks">
        <li>Installs like an app on iPhone and Android</li>
        <li>Works offline at the ground; syncs when you're back</li>
        <li>Passkeys instead of passwords</li>
        <li>Export or delete your data any time</li>
      </ul>
    </section>

    <section class="soon" aria-labelledby="demo-h">
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
    --maxw: 1120px;
    min-height: 100dvh;
    background:
      radial-gradient(
        1200px 600px at 80% -10%,
        color-mix(in srgb, #1f6f43 14%, transparent),
        transparent 60%
      ),
      radial-gradient(
        700px 500px at -10% 20%,
        color-mix(in srgb, #f2c230 10%, transparent),
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
    background: #1f6f43;
    color: #fff;
    box-shadow: 0 6px 20px rgb(31 111 67 / 0.3);
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
    color: #1f6f43;
  }
  :global(:root[data-theme='dark']) h1 span {
    color: #6fd39a;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) h1 span {
      color: #6fd39a;
    }
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
  }
  .phone {
    position: relative;
    max-width: 520px;
    margin: 0 auto;
    padding: 14px;
    border-radius: 30px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--e-3);
  }
  .float {
    position: absolute;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: var(--e-2);
    padding: 12px 14px;
    font-size: 0.8125rem;
  }
  .avail {
    left: -12px;
    bottom: -22px;
    width: 220px;
  }
  .avail strong {
    display: block;
    margin-bottom: 8px;
  }
  .bars {
    display: flex;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    gap: 2px;
    margin-bottom: 6px;
  }
  .bars .y {
    background: var(--ok);
  }
  .bars .m {
    background: #d79a1e;
  }
  .bars .n {
    background: var(--border-strong);
  }
  .avail small {
    color: var(--text-3);
  }
  .score {
    right: -10px;
    top: -18px;
    display: grid;
    grid-template-columns: auto auto auto;
    align-items: baseline;
    gap: 6px;
    font-weight: 800;
    font-size: 1.5rem;
  }
  .score small {
    font-size: 0.75rem;
    color: var(--text-3);
  }
  .score em {
    grid-column: 1 / -1;
    font-style: normal;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-2);
  }
  .features {
    padding: var(--s-12) 0;
  }
  .features h2,
  .promise h2 {
    font-size: clamp(1.6rem, 4vw, 2.25rem);
    letter-spacing: -0.03em;
    max-width: 22ch;
  }
  .features ul {
    list-style: none;
    padding: 0;
    margin: var(--s-8) 0 0;
    display: grid;
    gap: var(--s-4);
  }
  .feat {
    padding: var(--s-6);
    border-radius: var(--r-lg);
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .feat h3 {
    font-size: 1.125rem;
    margin: var(--s-3) 0 var(--s-2);
  }
  .feat p {
    color: var(--text-2);
    font-size: 0.9375rem;
  }
  .dot {
    display: block;
    width: 28px;
    height: 6px;
    border-radius: 3px;
    background: #1f6f43;
  }
  .sheet .dot,
  .export .dot {
    background: #f2c230;
  }
  .match .dot {
    background: #c2410c;
  }
  .promise {
    display: grid;
    gap: var(--s-6);
    padding: var(--s-10);
    border-radius: 24px;
    background: #13261a;
    color: #e9f3ec;
  }
  .promise p {
    color: #b9d2c1;
    margin-top: var(--s-3);
    max-width: 46ch;
  }
  .ticks {
    list-style: none;
    padding: 0;
    margin: 0;
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
  .soon {
    display: flex;
    gap: var(--s-5);
    align-items: center;
    margin: var(--s-12) 0;
    padding: var(--s-6);
    border-radius: var(--r-lg);
    border: 1px dashed var(--border-strong);
  }
  .soon {
    flex-wrap: wrap;
    border-style: solid;
    background: linear-gradient(
      135deg,
      color-mix(in srgb, #1f6f43 8%, var(--surface)),
      var(--surface)
    );
  }
  .soon .grow {
    flex: 1 1 280px;
  }
  .soon h2 {
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
    .features ul {
      grid-template-columns: 1fr 1fr;
    }
  }
  @media (min-width: 960px) {
    .hero {
      grid-template-columns: 1.05fr 1fr;
      padding: var(--s-16) 0;
    }
    .features ul {
      grid-template-columns: repeat(3, 1fr);
    }
    .promise {
      grid-template-columns: 1.2fr 1fr;
      padding: var(--s-12);
    }
  }
</style>
