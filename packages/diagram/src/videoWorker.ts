/**
 * Web Worker entry for video export. Load with
 *   new Worker(new URL('@phaseplay/diagram/videoWorker', import.meta.url), { type: 'module' })
 * and talk to it with exportVideoInWorker() (or post VideoWorkerRequest messages yourself).
 * Replies with { type: 'progress' } messages, then one 'done' (with the Blob) or 'error'.
 */
import { exportVideo, type VideoWorkerRequest, type VideoWorkerResponse } from './export/video';

type Scope = {
  postMessage(msg: VideoWorkerResponse): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<VideoWorkerRequest>) => void): void;
};

let current: AbortController | null = null;

/** Handle one request; exported for tests. */
export async function handleVideoRequest(
  msg: VideoWorkerRequest,
  reply: (m: VideoWorkerResponse) => void,
): Promise<void> {
  if (msg.type === 'cancel') {
    current?.abort();
    return;
  }
  current?.abort();
  const ctrl = new AbortController();
  current = ctrl;
  try {
    const res = await exportVideo(msg.play, {
      ...msg.options,
      signal: ctrl.signal,
      onProgress: (progress) => reply({ type: 'progress', progress }),
    });
    reply({ type: 'done', ...res });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    reply({ type: 'error', message: e instanceof Error ? e.message : String(e), aborted });
  } finally {
    if (current === ctrl) current = null;
  }
}

const scope = (typeof self !== 'undefined' ? self : undefined) as unknown as Scope | undefined;
// Only attach in a worker global (not when imported on the main thread or in tests).
if (
  scope &&
  typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined'
) {
  scope.addEventListener(
    'message',
    (e) => void handleVideoRequest(e.data, (m) => scope.postMessage(m)),
  );
}
