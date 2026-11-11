import sharp from 'sharp';

export const MAX_AVATAR_PHOTO_BYTES = 8 * 1024 * 1024;
export const AVATAR_PHOTO_MIME = Object.freeze({ 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' });
const invalid = () => new Error('Choose a valid JPEG, PNG or WebP photo.');

export async function processAvatarPhoto(bytes, mime) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_AVATAR_PHOTO_BYTES || !AVATAR_PHOTO_MIME[mime]) throw invalid();
  let metadata;
  try { metadata = await sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'error' }).metadata(); }
  catch { throw invalid(); }
  if (metadata.format !== AVATAR_PHOTO_MIME[mime] || !metadata.width || !metadata.height ||
    metadata.width > 8000 || metadata.height > 8000 || metadata.width * metadata.height > 20_000_000 ||
    (metadata.pages || 1) !== 1) throw invalid();
  try {
    const result = await sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'error' })
      .autoOrient().resize(256, 256, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
    if (result.length > 250_000) throw invalid();
    return result;
  } catch { throw invalid(); }
}
