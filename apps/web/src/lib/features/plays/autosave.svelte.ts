/**
 * Editor autosave (docs/diagrams.md §Editing model): every change is written to IndexedDB at once
 * (lightly debounced so a drag doesn't write 60 times a second), and synced to the server after
 * 2 s of quiet via the outbox. The If-Match base version is pinned when a burst of edits begins,
 * so a sync landing during the 2 s wait can't turn someone else's change into a silent overwrite.
 */
import { app } from '#lib/data/app.svelte';
import { docPut } from './persist';

export type SaveState = 'saved' | 'editing' | 'queued';

export class Autosave {
  state = $state<SaveState>('saved');
  private local: ReturnType<typeof setTimeout> | null = null;
  private remote: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private base: number | undefined;

  constructor(
    private readonly o: {
      key: string;
      snapshot: () => unknown;
      send: (baseVersion: number | undefined) => Promise<void>;
      /** Current server version of the row being edited (read when editing starts). */
      version?: () => number | undefined;
      delay?: number;
    },
  ) {}

  /** Call after every change. */
  touch() {
    if (!this.dirty) this.base = this.o.version?.();
    this.dirty = true;
    this.state = 'editing';
    if (this.local) clearTimeout(this.local);
    this.local = setTimeout(() => void this.writeLocal(), 150);
    if (this.remote) clearTimeout(this.remote);
    this.remote = setTimeout(() => void this.flush(), this.o.delay ?? 2000);
  }

  private async writeLocal() {
    this.local = null;
    await docPut(this.o.key, { ...(this.o.snapshot() as object), updatedAt: Date.now() });
  }

  /** Save now (on leave, before export, or after "Keep mine"). */
  async flush(force = false) {
    if (this.remote) clearTimeout(this.remote);
    this.remote = null;
    if (this.local) {
      clearTimeout(this.local);
      await this.writeLocal();
    }
    if (!this.dirty && !force) return;
    this.dirty = false;
    const base = this.base;
    this.base = undefined;
    await this.o.send(base);
    this.state = 'queued';
  }

  /** Human label for the header, announced politely. */
  get label(): string {
    if (this.state === 'editing') return 'Saving…';
    if (!app.online) return 'Saved on this device';
    if (app.pending > 0) return 'Syncing…';
    return 'All changes saved';
  }

  dispose() {
    void this.flush();
  }
}
