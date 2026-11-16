<script lang="ts">
  let { size = 32 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
  <rect width="512" height="512" rx="116" fill="var(--logo-bg, #1f6f43)" />
  <path
    d="M176 392V136h92c58 0 98 36 98 86s-40 86-98 86h-92"
    fill="none"
    stroke="#fff"
    stroke-width="58"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
  <ellipse cx="268" cy="222" rx="38" ry="24" fill="#f2c230" transform="rotate(-32 268 222)" />
</svg>
