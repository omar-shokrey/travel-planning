export type ImageFormat = 'jpeg' | 'png';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function startsWith(buffer: Buffer, signature: number[]): boolean {
  return (
    buffer.length >= signature.length &&
    signature.every((byte, index) => buffer[index] === byte)
  );
}

/**
 * Tells JPG from PNG by the first bytes of the file. The file name and the
 * type the client declares are not trusted: anyone can call a text file "a.png".
 * Returns null for anything else.
 */
export function detectImageFormat(buffer: Buffer): ImageFormat | null {
  if (startsWith(buffer, PNG_SIGNATURE)) return 'png';
  if (startsWith(buffer, JPEG_SIGNATURE)) return 'jpeg';
  return null;
}
