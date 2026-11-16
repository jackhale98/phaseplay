export type Toast = {
  id: number;
  message: string;
  tone: 'neutral' | 'success' | 'error' | 'warn';
  action?: { label: string; run: () => void };
  timeout: number;
};

let next = 1;
class Toasts {
  items = $state<Toast[]>([]);

  show(message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> = {}) {
    const t: Toast = {
      id: next++,
      message,
      tone: opts.tone ?? 'neutral',
      action: opts.action,
      timeout: opts.timeout ?? (opts.action ? 5000 : 3500),
    };
    this.items = [...this.items.slice(-2), t];
    if (t.timeout > 0) setTimeout(() => this.dismiss(t.id), t.timeout);
    return t.id;
  }
  /** Destructive actions get a 5-second undo (docs/design.md principle 4). */
  undo(message: string, run: () => void) {
    return this.show(message, { action: { label: 'Undo', run }, timeout: 5000 });
  }
  error(message: string) {
    return this.show(message, { tone: 'error', timeout: 6000 });
  }
  success(message: string) {
    return this.show(message, { tone: 'success' });
  }
  dismiss(id: number) {
    this.items = this.items.filter((t) => t.id !== id);
  }
}

export const toasts = new Toasts();
