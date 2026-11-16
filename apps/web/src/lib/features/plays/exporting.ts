/**
 * Lazy exporters: nothing here is imported until the coach actually exports, so the encoders
 * (mp4-muxer, gifenc) and the PNG painter stay out of the viewer and editor chunks.
 */
import type { Play } from '@phaseplay/shared';
import type { ExportSize } from '@phaseplay/diagram/export/common';
import type { ThemeName } from '@phaseplay/diagram/themes';
import type { VideoResult } from '@phaseplay/diagram/export/video';

export type ImageRequest = {
  play: Play;
  frameIndex: number | 'storyboard';
  size: ExportSize;
  theme: ThemeName;
  accent: string;
  title?: string;
  monogram?: { text: string; bg: string; fg: string };
  highlightMemberId?: string;
};

export async function playImage(o: ImageRequest): Promise<Blob> {
  const { renderPlayImage } = await import('@phaseplay/diagram/export/png');
  return renderPlayImage({ ...o, scale: 2 });
}

export type VideoRequest = {
  play: Play;
  size: ExportSize;
  theme: ThemeName;
  accent: string;
  title?: string;
  highlightMemberId?: string;
  onProgress: (p: number) => void;
  signal: AbortSignal;
};

/** MP4 (WebCodecs) or GIF in a worker; falls back to the main thread (MediaRecorder WebM). */
export async function playVideo(o: VideoRequest): Promise<VideoResult> {
  const { onProgress, signal, play, ...opts } = o;
  const video = await import('@phaseplay/diagram/export/video');
  const hasWebCodecs =
    typeof VideoEncoder !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
  if (hasWebCodecs && typeof Worker !== 'undefined') {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./video.worker.ts', import.meta.url), { type: 'module' });
      return await video.exportVideoInWorker(worker, play, {
        ...opts,
        prefer: 'webcodecs',
        onProgress,
        signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
    } finally {
      worker?.terminate();
    }
  }
  return video.exportVideo(play, { ...opts, onProgress, signal });
}
