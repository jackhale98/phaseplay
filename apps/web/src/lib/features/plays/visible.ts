/** Svelte action: call `fn` once when the node first scrolls near the viewport. */
export function onVisible(node: Element, fn: () => void) {
  if (typeof IntersectionObserver === 'undefined') {
    fn();
    return {};
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        fn();
      }
    },
    { rootMargin: '200px' },
  );
  io.observe(node);
  return { destroy: () => io.disconnect() };
}
