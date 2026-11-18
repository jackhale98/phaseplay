/**
 * The pages (or photos) being edited in an upload sheet: existing images plus newly picked files,
 * each prepared in the browser one at a time (progress, cancel), then uploaded in order on save.
 */
import { MEDIA_CAPTION_MAX, uuidv7, type MediaOwner, type MediaRef } from '@phaseplay/shared';
import { ApiError } from '#lib/api';
import { prepareImage, PrepareError, type Prepared } from './compress';
import { setImages, uploadImage, type UploadResult } from './upload';

export type Draft = {
  id: string;
  remote: MediaRef | null;
  name: string;
  prepared: Prepared | null;
  preview: string | null;
  caption: string;
  state: 'waiting' | 'preparing' | 'ready' | 'uploading' | 'done' | 'error';
  progress: number;
  error: string | null;
};

export class Drafts {
  items = $state<Draft[]>([]);
  /** Announced politely (aria-live) by the editor. */
  status = $state('');
  // Bookkeeping only (the UI renders `items`).
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private files = new Map<string, File>();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private aborts = new Map<string, AbortController>();
  private preparing = false;

  constructor(
    public readonly max: number,
    existing: MediaRef[] = [],
  ) {
    this.items = existing.map((m) => ({
      id: m.id,
      remote: m,
      name: '',
      prepared: null,
      preview: null,
      caption: m.caption ?? '',
      state: 'done',
      progress: 1,
      error: null,
    }));
  }

  get busy() {
    return this.items.some((d) => d.state === 'waiting' || d.state === 'preparing');
  }
  get count() {
    return this.items.filter((d) => d.state !== 'error').length;
  }
  get changed() {
    return this.items.some((d) => !d.remote) || this.dirtyRemote;
  }
  private initial = '';
  /** Remember the server state so "changed" knows whether order/captions/removals moved. */
  snapshot() {
    this.initial = this.key();
  }
  private key() {
    return JSON.stringify(
      this.items.filter((d) => d.remote).map((d) => [d.id, d.caption.trim() || null]),
    );
  }
  get dirtyRemote() {
    return this.key() !== this.initial;
  }

  /** Add picked or dropped files (beyond the cap they're refused with a message). */
  add(files: Iterable<File>) {
    let refused = 0;
    for (const f of files) {
      if (this.count >= this.max) {
        refused++;
        continue;
      }
      const id = uuidv7();
      this.files.set(id, f);
      this.items.push({
        id,
        remote: null,
        name: f.name || 'Picture',
        prepared: null,
        preview: null,
        caption: '',
        state: 'waiting',
        progress: 0,
        error: null,
      });
    }
    if (refused) this.status = `Only ${this.max} allowed; ${refused} not added.`;
    void this.pump();
  }

  private find(id: string) {
    return this.items.find((d) => d.id === id);
  }

  private async pump() {
    if (this.preparing) return;
    this.preparing = true;
    try {
      for (;;) {
        const d = this.items.find((x) => x.state === 'waiting');
        if (!d) break;
        const file = this.files.get(d.id);
        if (!file) {
          d.state = 'error';
          continue;
        }
        d.state = 'preparing';
        const ac = new AbortController();
        this.aborts.set(d.id, ac);
        try {
          const p = await prepareImage(file, {
            signal: ac.signal,
            onProgress: (f) => {
              const cur = this.find(d.id);
              if (cur) cur.progress = f;
            },
          });
          const cur = this.find(d.id);
          if (!cur) continue;
          cur.prepared = p;
          cur.preview = URL.createObjectURL(p.thumb ?? p.blob);
          cur.state = 'ready';
          cur.progress = 1;
          this.status = `${cur.name} ready (${Math.round(p.blob.size / 1024)} KB).`;
        } catch (e) {
          const cur = this.find(d.id);
          if (!cur) continue;
          if ((e as Error).name === 'AbortError') continue;
          cur.state = 'error';
          cur.error =
            e instanceof PrepareError ? e.message : 'Something went wrong preparing that picture.';
          this.status = `${cur.name}: ${cur.error}`;
        } finally {
          this.aborts.delete(d.id);
          this.files.delete(d.id);
        }
      }
    } finally {
      this.preparing = false;
    }
  }

  /** Remove a page; cancels its preparation or upload if one is running. */
  remove(id: string) {
    this.aborts.get(id)?.abort();
    const d = this.find(id);
    if (d?.preview) URL.revokeObjectURL(d.preview);
    this.files.delete(id);
    this.items = this.items.filter((x) => x.id !== id);
  }

  move(id: string, delta: -1 | 1) {
    const i = this.items.findIndex((x) => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.items.length) return;
    const next = [...this.items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    this.items = next;
    this.status = `Moved to position ${j + 1} of ${next.length}.`;
  }

  /** Stop whatever is running (prepare or upload). */
  cancelAll() {
    for (const ac of this.aborts.values()) ac.abort();
    this.saving?.abort();
  }

  private saving: AbortController | null = null;

  /**
   * Upload new pages in order, then (when something else changed) set order, captions and
   * removals in one call. Returns the final list. Throws ApiError / AbortError.
   */
  async save(owner: MediaOwner, ownerId: string): Promise<MediaRef[] | null> {
    const ac = new AbortController();
    this.saving = ac;
    let list: MediaRef[] | null = null;
    let uploaded = 0;
    try {
      for (const d of this.items) {
        if (d.remote || d.state === 'error') continue;
        if (!d.prepared) throw new Error('Still preparing pictures');
        d.state = 'uploading';
        d.progress = 0;
        let r: UploadResult;
        try {
          r = await uploadImage(
            owner,
            ownerId,
            {
              id: d.id,
              caption: d.caption.trim().slice(0, MEDIA_CAPTION_MAX) || null,
              prepared: d.prepared,
            },
            { signal: ac.signal, onProgress: (f) => (d.progress = f) },
          );
        } catch (e) {
          d.state = (e as Error).name === 'AbortError' ? 'ready' : 'error';
          if (e instanceof ApiError) d.error = e.message;
          throw e;
        }
        d.state = 'done';
        d.progress = 1;
        d.remote = r.media;
        list = r.list;
        uploaded++;
        this.status = `Uploaded ${uploaded}.`;
      }
      const wanted = this.items
        .filter((d) => d.remote)
        .map((d) => ({ id: d.id, caption: d.caption.trim() || null }));
      const same =
        list &&
        list.length === wanted.length &&
        list.every((m, i) => m.id === wanted[i]!.id && (m.caption ?? null) === wanted[i]!.caption);
      if (!same && (list || this.dirtyRemote))
        list = (await setImages(owner, ownerId, wanted)).list;
      this.snapshot();
      return list;
    } finally {
      this.saving = null;
    }
  }

  dispose() {
    this.cancelAll();
    for (const d of this.items) if (d.preview) URL.revokeObjectURL(d.preview);
  }
}
