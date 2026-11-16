<!-- Zero-JS animated strike move for the landing page. CSS transforms on SVG; reduced motion shows the end state. -->
<svg
  viewBox="0 0 360 300"
  role="img"
  aria-label="An animated backline move: the ball goes from the scrum-half through the fly-half and centre to the winger, who scores."
>
  <defs>
    <pattern id="stripes" width="60" height="300" patternUnits="userSpaceOnUse">
      <rect width="30" height="300" fill="#2f8a52" />
      <rect x="30" width="30" height="300" fill="#2a804c" />
    </pattern>
    <marker
      id="arr"
      viewBox="0 0 10 10"
      refX="7"
      refY="5"
      markerWidth="5"
      markerHeight="5"
      orient="auto-start-reverse"
    >
      <path d="M0 0 10 5 0 10z" fill="#fff" opacity=".8" />
    </marker>
  </defs>
  <rect width="360" height="300" rx="18" fill="url(#stripes)" />
  <g stroke="#fff" stroke-opacity=".85" stroke-width="2" fill="none">
    <path d="M300 0v300" />
    <path d="M100 0v300" stroke-opacity=".6" />
    <path d="M200 0v300" stroke-dasharray="8 8" stroke-opacity=".45" />
    <path d="M0 30h360M0 270h360" stroke-dasharray="6 10" stroke-opacity=".35" />
    <path d="M300 128h50M300 172h50" stroke-opacity=".5" />
  </g>
  <text
    x="306"
    y="22"
    fill="#fff"
    fill-opacity=".7"
    font-size="10"
    font-weight="700"
    font-family="PP Sans, system-ui">TRY LINE</text
  >
  <text
    x="104"
    y="22"
    fill="#fff"
    fill-opacity=".55"
    font-size="10"
    font-weight="700"
    font-family="PP Sans, system-ui">22</text
  >
  <path
    class="trail"
    d="M150 250 C210 246 262 238 300 232"
    stroke="#fff"
    stroke-width="2.5"
    fill="none"
    stroke-dasharray="5 6"
    marker-end="url(#arr)"
  />

  <g class="def">
    {#each [[232, 136], [236, 176], [240, 214], [252, 254]] as [x, y], i (i)}
      <g transform="translate({x} {y})"
        ><g class="dl"
          ><rect
            x="-10"
            y="-10"
            width="20"
            height="20"
            rx="5"
            fill="#13261a"
            stroke="#cfe9d6"
            stroke-width="1.5"
          /></g
        ></g
      >
    {/each}
  </g>
  {#each [{ n: 9, x: 60, y: 150, c: 'r9' }, { n: 10, x: 90, y: 182, c: 'r10' }, { n: 12, x: 122, y: 214, c: 'r12' }, { n: 14, x: 150, y: 250, c: 'r14' }] as t (t.n)}
    <g transform="translate({t.x} {t.y})">
      <g class="tok {t.c}">
        <circle r="12" fill="#f4f7f4" />
        <circle r="10" fill="#1f6f43" />
        <text
          text-anchor="middle"
          dominant-baseline="central"
          fill="#fff"
          font-size="11"
          font-weight="800"
          font-family="PP Sans, system-ui">{t.n}</text
        >
      </g>
    </g>
  {/each}
  <g class="ball">
    <ellipse cx="0" cy="9" rx="6" ry="2.2" fill="#000" opacity=".25" />
    <ellipse
      rx="7"
      ry="4.6"
      fill="#f2c230"
      stroke="#7a5a00"
      stroke-width="1"
      transform="rotate(-25)"
    />
  </g>
</svg>

<style>
  svg {
    width: 100%;
    height: auto;
    border-radius: 18px;
  }
  .tok,
  .dl,
  .ball {
    animation: var(--a) 7s var(--ease, cubic-bezier(0.45, 0, 0.25, 1)) infinite both;
  }
  .r9 {
    --a: r9;
  }
  .r10 {
    --a: r10;
  }
  .r12 {
    --a: r12;
  }
  .r14 {
    --a: r14;
  }
  .dl {
    --a: dl;
  }
  .ball {
    --a: ball;
    animation-timing-function: linear;
  }
  .trail {
    animation: trail 7s linear infinite both;
  }
  @keyframes r9 {
    0%,
    15% {
      transform: translate(0, 0);
    }
    75%,
    100% {
      transform: translate(40px, -2px);
    }
  }
  @keyframes r10 {
    0%,
    15% {
      transform: translate(0, 0);
    }
    75%,
    100% {
      transform: translate(85px, -12px);
    }
  }
  @keyframes r12 {
    0%,
    15% {
      transform: translate(0, 0);
    }
    75%,
    100% {
      transform: translate(103px, -18px);
    }
  }
  @keyframes r14 {
    0%,
    15% {
      transform: translate(0, 0);
    }
    75%,
    100% {
      transform: translate(150px, -18px);
    }
  }
  @keyframes dl {
    0%,
    15% {
      transform: translate(0, 0);
    }
    75%,
    100% {
      transform: translate(-28px, 0);
    }
  }
  @keyframes ball {
    0%,
    20% {
      transform: translate(62px, 148px);
      opacity: 1;
    }
    30% {
      transform: translate(111px, 179px);
    }
    45% {
      transform: translate(173px, 205px);
    }
    58% {
      transform: translate(257px, 237px);
    }
    75% {
      transform: translate(298px, 230px);
    }
    92% {
      transform: translate(298px, 230px);
      opacity: 1;
    }
    100% {
      transform: translate(298px, 230px);
      opacity: 0;
    }
  }
  @keyframes trail {
    0%,
    50% {
      opacity: 0;
    }
    62%,
    92% {
      opacity: 0.75;
    }
    100% {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ball {
      animation: none;
      transform: translate(298px, 230px);
    }
    .trail {
      animation: none;
      opacity: 0.75;
    }
  }
</style>
