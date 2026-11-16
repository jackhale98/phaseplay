/**
 * Video export (docs/diagrams.md §Exports — Video). Feature-detected at runtime, encoders lazy:
 *   (a) MP4 H.264 via WebCodecs VideoEncoder + mp4-muxer, rendered frame by frame (worker-safe);
 *   (b) WebM/MP4 via MediaRecorder on canvas.captureStream(), rendered in real time (main thread);
 *   (c) animated GIF at 15 fps via gifenc.
 * Every frame is painted by the same sample() + draw() path as the viewer and PNG export.
 */
import type { Play } from '@phaseplay/shared';
import { type CanvasFactory, type CanvasLike, context2d, defaultCanvasFactory } from '../canvas';
import { totalDuration } from '../sample';
import type { Theme, ThemeName } from '../themes';
import { type ExportSize, parseSize, throwIfAborted } from './common';
import { type PaintCache, type PlayImageOptions, paintPlayAt } from './png';

export type VideoMethod = 'webcodecs' | 'mediarecorder' | 'gif';

export type VideoOptions = {
  size?: ExportSize;
  fps?: number;
  theme?: Theme | ThemeName;
  accent: string;
  title?: string;
  captions?: boolean;
  highlightMemberId?: string;
  /** Still time before and after the animation (ms, default 600). */
  holdMs?: number;
  /** Called when a method fails and the next one is tried. */
  onFallback?: (failed: VideoMethod, error: unknown) => void;
  /** Progress 0..1. */
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
  /** Force a method (skips detection); falls back if it is unavailable. */
  prefer?: VideoMethod;
  /** Longest GIF side in px (default 640). */
  maxGifSide?: number;
  /** H.264 bitrate (default ~6 Mbps at 1080p). */
  bitrate?: number;
  factory?: CanvasFactory;
};

export type VideoResult = { blob: Blob; mime: string; ext: 'mp4' | 'webm' | 'gif' };

const AVC_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.42001f'];

async function pickAvcCodec(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<string | null> {
  if (
    typeof VideoEncoder === 'undefined' ||
    typeof VideoFrame === 'undefined' ||
    typeof OffscreenCanvas === 'undefined'
  )
    return null;
  for (const codec of AVC_CODECS) {
    try {
      const res = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
      });
      if (res.supported) return codec;
    } catch {
      /* try the next profile */
    }
  }
  return null;
}

function recorderMime(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof document === 'undefined') return null;
  if (typeof HTMLCanvasElement === 'undefined' || !('captureStream' in HTMLCanvasElement.prototype))
    return null;
  for (const m of [
    'video/mp4;codecs=avc1',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ])
    if (MediaRecorder.isTypeSupported(m)) return m;
  return null;
}

/** Which method exportVideo would use here, best first. */
export async function detectVideoSupport(
  size: ExportSize = '1080x1920',
  fps = 30,
): Promise<VideoMethod> {
  const { w, h } = parseSize(size);
  if (await pickAvcCodec(w, h, fps, defaultBitrate(w, h))) return 'webcodecs';
  if (recorderMime()) return 'mediarecorder';
  return 'gif';
}

const defaultBitrate = (w: number, h: number) => Math.round(6_000_000 * ((w * h) / (1920 * 1080)));
const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

type Painter = { canvas: CanvasLike; duration: number; paint: (t: number) => void };

function makePainter(
  play: Play,
  o: VideoOptions,
  W: number,
  H: number,
  canvas: CanvasLike,
): Painter {
  const ctx = context2d(canvas);
  const hold = o.holdMs ?? 600;
  const total = totalDuration(play);
  const img: PlayImageOptions = {
    play,
    frameIndex: 0,
    size: o.size ?? '1080x1920',
    theme: o.theme,
    accent: o.accent,
    title: o.title,
    captions: o.captions,
    highlightMemberId: o.highlightMemberId,
  };
  const cache: PaintCache = { layerFactory: o.factory ?? defaultCanvasFactory };
  return {
    canvas,
    duration: total + 2 * hold,
    paint: (t) => paintPlayAt(ctx, W, H, img, Math.max(0, Math.min(total, t - hold)), cache),
  };
}

async function viaWebCodecs(
  play: Play,
  o: VideoOptions,
  W: number,
  H: number,
  fps: number,
): Promise<VideoResult> {
  const bitrate = o.bitrate ?? defaultBitrate(W, H);
  const codec = await pickAvcCodec(W, H, fps, bitrate);
  if (!codec) throw new Error('H.264 encoding unavailable');
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
  const painter = makePainter(play, o, W, H, (o.factory ?? defaultCanvasFactory)(W, H));
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: W, height: H, frameRate: fps },
    fastStart: 'in-memory',
  });
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  encoder.configure({
    codec,
    width: W,
    height: H,
    bitrate,
    framerate: fps,
    avc: { format: 'avc' },
  });
  const n = Math.max(1, Math.ceil((painter.duration / 1000) * fps));
  const frameUs = 1e6 / fps;
  try {
    for (let i = 0; i < n; i++) {
      throwIfAborted(o.signal);
      if (failure) throw failure;
      painter.paint((i * 1000) / fps);
      const frame = new VideoFrame(painter.canvas as unknown as OffscreenCanvas, {
        timestamp: Math.round(i * frameUs),
        duration: Math.round(frameUs),
      });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 6) await tick();
      o.onProgress?.((i + 1) / (n + 1));
    }
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  o.onProgress?.(1);
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), mime: 'video/mp4', ext: 'mp4' };
}

async function viaMediaRecorder(
  play: Play,
  o: VideoOptions,
  W: number,
  H: number,
  fps: number,
): Promise<VideoResult> {
  const mime = recorderMime();
  if (!mime) throw new Error('MediaRecorder unavailable');
  const el = document.createElement('canvas');
  el.width = W;
  el.height = H;
  const painter = makePainter(play, o, W, H, el as unknown as CanvasLike);
  const stream = el.captureStream(fps);
  const rec = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: o.bitrate ?? defaultBitrate(W, H),
  });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
  painter.paint(0);
  rec.start(250);
  const start = performance.now();
  let aborted = false;
  await new Promise<void>((resolve) => {
    const step = () => {
      if (o.signal?.aborted) {
        aborted = true;
        return resolve();
      }
      const t = performance.now() - start;
      painter.paint(t);
      o.onProgress?.(Math.min(0.99, t / painter.duration));
      if (t >= painter.duration) return resolve();
      // rAF stalls in background tabs; fall back to timers when hidden.
      if (typeof requestAnimationFrame !== 'undefined' && document.visibilityState !== 'hidden')
        requestAnimationFrame(step);
      else setTimeout(step, 1000 / fps);
    };
    step();
  });
  rec.stop();
  stream.getTracks().forEach((tr) => tr.stop());
  await stopped;
  throwIfAborted(o.signal);
  if (aborted) throw new DOMException('Export cancelled', 'AbortError');
  const type = mime.split(';')[0] as string;
  o.onProgress?.(1);
  return {
    blob: new Blob(chunks, { type }),
    mime: type,
    ext: type.includes('mp4') ? 'mp4' : 'webm',
  };
}

async function viaGif(play: Play, o: VideoOptions, W: number, H: number): Promise<VideoResult> {
  const mod = await import('gifenc');
  const lib = (
    typeof mod.GIFEncoder === 'function' ? mod : (mod as unknown as { default: typeof mod }).default
  ) as typeof mod;
  const k = Math.min(1, (o.maxGifSide ?? 640) / Math.max(W, H));
  const gw = Math.max(2, Math.round(W * k));
  const gh = Math.max(2, Math.round(H * k));
  const canvas = (o.factory ?? defaultCanvasFactory)(gw, gh);
  const ctx = context2d(canvas);
  const painter = makePainter(play, o, gw, gh, canvas);
  const fps = 15;
  const n = Math.max(1, Math.ceil((painter.duration / 1000) * fps));
  const gif = lib.GIFEncoder();
  for (let i = 0; i < n; i++) {
    throwIfAborted(o.signal);
    painter.paint((i * 1000) / fps);
    const { data } = ctx.getImageData(0, 0, gw, gh);
    const palette = lib.quantize(data, 256);
    gif.writeFrame(lib.applyPalette(data, palette), gw, gh, {
      palette,
      delay: Math.round(1000 / fps),
    });
    o.onProgress?.((i + 1) / (n + 1));
    if (i % 4 === 3) await tick();
  }
  gif.finish();
  o.onProgress?.(1);
  return {
    blob: new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: 'image/gif' }),
    mime: 'image/gif',
    ext: 'gif',
  };
}

/**
 * Export the play's animation as a video: MP4 via WebCodecs where possible, else MediaRecorder
 * (WebM or MP4), else an animated GIF. Rejects with an AbortError when `signal` aborts.
 */
export async function exportVideo(play: Play, o: VideoOptions): Promise<VideoResult> {
  const { w, h } = parseSize(o.size ?? '1080x1920');
  const fps = o.fps ?? 30;
  throwIfAborted(o.signal);
  const order: VideoMethod[] = ['webcodecs', 'mediarecorder', 'gif'];
  if (o.prefer) order.sort((a, b) => (a === o.prefer ? -1 : b === o.prefer ? 1 : 0));
  let lastError: unknown = null;
  for (const method of order) {
    try {
      if (method === 'webcodecs') return await viaWebCodecs(play, o, w, h, fps);
      if (method === 'mediarecorder') return await viaMediaRecorder(play, o, w, h, fps);
      return await viaGif(play, o, w, h);
    } catch (e) {
      if (isAbort(e)) throw e;
      lastError = e;
      o.onFallback?.(method, e);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Video export failed');
}

// ---------------------------------------------------------------------------------------------
// Worker protocol (see videoWorker.ts)

export type VideoWorkerOptions = Omit<VideoOptions, 'onProgress' | 'signal' | 'factory'>;
export type VideoWorkerRequest =
  { type: 'export'; play: Play; options: VideoWorkerOptions } | { type: 'cancel' };
export type VideoWorkerResponse =
  | { type: 'progress'; progress: number }
  | { type: 'done'; blob: Blob; mime: string; ext: VideoResult['ext'] }
  | { type: 'error'; message: string; aborted: boolean };

type WorkerLike = {
  postMessage(msg: VideoWorkerRequest): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<VideoWorkerResponse>) => void): void;
  removeEventListener(type: 'message', fn: (e: MessageEvent<VideoWorkerResponse>) => void): void;
};

/**
 * Run exportVideo in a worker created from videoWorker.ts, e.g.
 * `new Worker(new URL('@phaseplay/diagram/videoWorker', import.meta.url), { type: 'module' })`.
 * Workers have no MediaRecorder, so they produce MP4 (WebCodecs) or GIF.
 */
export function exportVideoInWorker(
  worker: WorkerLike,
  play: Play,
  options: VideoWorkerOptions & { onProgress?: (p: number) => void; signal?: AbortSignal },
): Promise<VideoResult> {
  const { onProgress, signal, ...rest } = options;
  return new Promise((resolve, reject) => {
    const onAbort = () => worker.postMessage({ type: 'cancel' });
    const listener = (e: MessageEvent<VideoWorkerResponse>) => {
      const m = e.data;
      if (m.type === 'progress') return onProgress?.(m.progress);
      worker.removeEventListener('message', listener);
      signal?.removeEventListener('abort', onAbort);
      if (m.type === 'done') resolve({ blob: m.blob, mime: m.mime, ext: m.ext });
      else reject(m.aborted ? new DOMException(m.message, 'AbortError') : new Error(m.message));
    };
    worker.addEventListener('message', listener);
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.postMessage({ type: 'export', play, options: rest });
  });
}
