/**
 * Image uploads (need a connection; they don't go through the outbox, since a queued 400 KB blob
 * per page would fill IndexedDB and the play must exist first). XHR is used for upload progress.
 */
import { mediaUrl, type MediaOwner, type MediaRef, type MediaSet } from '@phaseplay/shared';
import { api, ApiError } from '#lib/api';
import { app } from '#lib/data/app.svelte';
import { teamPath } from '#lib/data/actions';
import type { Prepared } from './compress';

export const ownerPath = (owner: MediaOwner, id: string) =>
  teamPath(`/${owner === 'play' ? 'plays' : 'drills'}/${id}/media`);

/** Same-origin URL of an image (or its thumbnail), versioned so it can be cached forever. */
export const mediaSrc = (m: Pick<MediaRef, 'id' | 'v'>, thumb = false) =>
  app.teamId ? mediaUrl(app.teamId, m, thumb) : '';

export type UploadResult = { media: MediaRef | null; list: MediaRef[] };

export function uploadImage(
  owner: MediaOwner,
  ownerId: string,
  page: { id: string; caption: string | null; prepared: Prepared },
  opts: { onProgress?: (f: number) => void; signal?: AbortSignal } = {},
): Promise<UploadResult> {
  const ext = page.prepared.type.split('/')[1];
  const form = new FormData();
  form.set('id', page.id);
  if (page.caption) form.set('caption', page.caption);
  form.set('file', page.prepared.blob, `page.${ext}`);
  if (page.prepared.thumb) form.set('thumb', page.prepared.thumb, `thumb.${ext}`);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', ownerPath(owner, ownerId));
    xhr.withCredentials = true;
    xhr.responseType = 'text';
    xhr.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data: Record<string, unknown> | null = null;
      try {
        data = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data as UploadResult);
      const err = (data?.error ?? {}) as { code?: string; message?: string };
      reject(
        new ApiError(
          xhr.status,
          (err.code as ApiError['code']) ?? 'internal',
          err.message ?? `Upload failed (${xhr.status})`,
        ),
      );
    };
    xhr.onerror = () =>
      reject(new ApiError(0, 'network', 'Upload failed: check your connection and try again.'));
    xhr.onabort = () => reject(new DOMException('Cancelled', 'AbortError'));
    opts.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    if (opts.signal?.aborted) return xhr.abort();
    xhr.send(form);
  });
}

/** Order, captions and removal in one call: images not listed are deleted. */
export const setImages = (owner: MediaOwner, ownerId: string, pages: MediaSet['pages']) =>
  api<{ list: MediaRef[] }>(ownerPath(owner, ownerId), { method: 'PUT', body: { pages } });

/** Put the owner's new image list into the local snapshot straight away (sync confirms later). */
export async function applyList(owner: MediaOwner, ownerId: string, list: MediaRef[]) {
  const teamId = app.teamId;
  const entity = owner === 'play' ? 'plays' : 'drills';
  const row = app.snap?.rows[entity][ownerId];
  if (!teamId || !row) return;
  await app.putRow(teamId, entity, ownerId, { ...row, media: list, updatedAt: Date.now() });
}

/** The image bytes (from the HTTP or service-worker cache when possible), for sharing. */
export async function imageBlob(m: Pick<MediaRef, 'id' | 'v'>): Promise<Blob> {
  const r = await fetch(mediaSrc(m), { credentials: 'same-origin' });
  if (!r.ok) throw new Error('Could not load that image');
  return r.blob();
}
