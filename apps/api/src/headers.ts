/**
 * Security headers for every HTML response. Script hashes live in the meta CSP that SvelteKit
 * generates (kit.csp, hash mode); this header adds what a meta tag can't express.
 */
export const DOCUMENT_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
