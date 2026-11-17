# Phaseplay brand kit

The mark is a shield crest with a loop play drawn on a striped pitch. In the play, the first receiver passes, loops around her teammate and breaks through the gain line. A PHASEPLAY ribbon runs across the bottom of the shield.

## Files

| File | Use |
| --- | --- |
| `phaseplay-logo.svg` | Primary full-colour crest with ribbon (landing page, About, exports) |
| `phaseplay-logo-mono-chalk.svg` | One-colour crest for dark or green backgrounds |
| `phaseplay-logo-mono-ink.svg` | One-colour crest for light backgrounds and print |
| `phaseplay-mark.svg` | Simplified crest (no ribbon or text) for ≤ 64 px: nav bar, avatars, small UI |
| `phaseplay-loader.svg` | Animated loading loop: the play runs, fades and repeats. Self-contained CSS animation that respects `prefers-reduced-motion` |
| `favicon.ico`, `png/favicon-*.png` | Favicons, 16/32/48 |
| `png/apple-touch-icon-180.png` | iOS home screen |
| `png/icon-192.png`, `png/icon-512.png` | PWA manifest icons (`purpose: "any"`) |
| `png/icon-maskable-512.png` | PWA manifest icon (`purpose: "maskable"`), with the crest inside the safe zone |

## Colours

| Token | Hex | Role |
| --- | --- | --- |
| Ink | `#0F2A20` | Shield border, text, dark surfaces |
| Pitch | `#1E7A55` | Primary brand green, field |
| Pitch stripe | `#238760` | Field stripes |
| Chalk | `#F5F2EA` | Players, lines, ribbon, text on dark |
| Paper | `#F7F4EC` | Light surfaces |
| Amber | `#E9A23B` | The ball, accent (use sparingly) |

## Type

- **Archivo**, expanded (`font-stretch: 125%`), weight 800, letter-spacing 0.06em, all caps, is used for the wordmark and the ribbon. It's open source on Google Fonts; self-host a Latin-subset woff2.
- The ribbon text in the logo SVGs is live text. On first use (M0), outline it to paths with the self-hosted Archivo, or make sure the font is loaded wherever an SVG is shown. Until then, it falls back to Helvetica/Arial.

## Loader

- Inline `phaseplay-loader.svg`, or use it as an `<img>`; the CSS animation runs either way.
- The default loop is 3.6 s. Change `animation-duration` on the `.pp-*` rules to adjust it, keeping the same value on every rule.
- Show it only after about 300 ms of waiting, so quick loads never flash a spinner. Give it `role="status"` and the text "Loading" for screen readers.
