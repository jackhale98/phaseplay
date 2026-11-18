/** Share a file with the Web Share API on mobile, otherwise download it. */
export async function shareOrDownload(
  blob: Blob,
  filename: string,
  title?: string,
): Promise<'shared' | 'downloaded' | 'cancelled' | 'blocked'> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (coarse && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
      // No longer "right after a tap" (slow render): the caller offers its own Share button.
      if ((e as Error).name === 'NotAllowedError') return 'blocked';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}

export async function copyImage(blob: Blob): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function shareLink(
  url: string,
  title: string,
  text?: string,
): Promise<'shared' | 'copied' | 'failed'> {
  if (matchMedia('(pointer: coarse)').matches && navigator.share) {
    try {
      await navigator.share({ url, title, text });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'failed';
    }
  }
  return (await copyText(url)) ? 'copied' : 'failed';
}

/**
 * Share several files at once (picture-play pages) on phones; elsewhere download them one by one.
 * Falls back to the first file alone where the share sheet can't take several.
 */
export async function shareFiles(
  files: File[],
  title?: string,
): Promise<'shared' | 'downloaded' | 'cancelled' | 'blocked'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (coarse && files.length > 1 && nav.canShare?.({ files })) {
    try {
      await nav.share({ files, title });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
      if ((e as Error).name === 'NotAllowedError') return 'blocked';
    }
  }
  if (files.length === 1 || coarse) return shareOrDownload(files[0]!, files[0]!.name, title);
  for (const [i, f] of files.entries()) {
    if (i) await new Promise((r) => setTimeout(r, 350));
    await shareOrDownload(f, f.name, title);
  }
  return 'downloaded';
}
