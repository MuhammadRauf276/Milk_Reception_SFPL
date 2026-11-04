import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolvePhotoPath } from './capturedPhotoService';

export const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_FOLDER = '.thumbs';

/**
 * A small copy of a stored photo, made once and then read from disk. Returns null when it cannot be made, and the
 * caller then serves the original, so a missing image library can only make a photo slower, never break it.
 */
export async function getPhotoThumbnail(captureId: string, originalPath: string): Promise<Buffer | null> {
  const thumbPath = resolvePhotoPath(path.join(THUMBNAIL_FOLDER, `${captureId}-w${THUMBNAIL_WIDTH}.jpg`));
  if (!thumbPath) return null;
  try {
    return await readFile(thumbPath);
  } catch {
    // Not made yet.
  }
  try {
    const { default: sharp } = await import('sharp');
    const thumbnail = await sharp(originalPath)
      .rotate()
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();
    await mkdir(path.dirname(thumbPath), { recursive: true });
    // Two requests can make the same thumbnail at once; a rename means neither ever reads a half-written file.
    const tempPath = `${thumbPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, thumbnail);
    await rename(tempPath, thumbPath);
    return thumbnail;
  } catch {
    return null;
  }
}
