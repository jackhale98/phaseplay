<!--
  The Phaseplay mark: the crest without its ribbon, for 64 px and below (docs/design.md §Brand).
  Inline so it needs no request; the clip-path id is unique per instance.
-->
<script lang="ts">
  let { size = 32, label }: { size?: number; label?: string } = $props();
  const id = `ppm-${Math.random().toString(36).slice(2, 8)}`;
  const SHIELD =
    'M50 5 C62 11 78 13 93 13 L93 54 C93 83 74 103 50 115 C26 103 7 83 7 54 L7 13 C22 13 38 11 50 5 Z';
  const stripes = Array.from({ length: 15 }, (_, i) => i * 8);
</script>

<svg
  width={Math.round((size * 108) / 120)}
  height={size}
  viewBox="-4 0 108 120"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  <defs>
    <clipPath {id}><path d={SHIELD} transform="translate(8 8.64) scale(0.84)" /></clipPath>
  </defs>
  <path d={SHIELD} fill="#0F2A20" />
  <g clip-path="url(#{id})">
    {#each stripes as y, i (y)}<rect
        x="0"
        {y}
        width="100"
        height="8"
        fill={i % 2 ? '#238760' : '#1E7A55'}
      />{/each}
    <g transform="translate(50 56) scale(0.8) translate(-51.5 -63)">
      <path
        d="M30 72 C36 86 58 92 68 80 C74 72 73 50 73 37"
        fill="none"
        stroke="#F5F2EA"
        stroke-width="7"
        stroke-linecap="round"
      />
      <path
        d="M66 43 L73 36 L80 43"
        fill="none"
        stroke="#F5F2EA"
        stroke-width="7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="30" cy="64" r="9" fill="#F5F2EA" />
      <circle cx="52" cy="70" r="9" fill="#F5F2EA" />
      <path
        d="M-7 0 Q0 -10.15 7 0 Q0 10.15 -7 0 Z"
        transform="translate(20 50) rotate(-35)"
        fill="#E9A23B"
      />
    </g>
  </g>
</svg>
