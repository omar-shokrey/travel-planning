import { detectImageFormat } from './image-format';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const bytes = (...values: number[]): Buffer => Buffer.from(values);

describe('detectImageFormat', () => {
  it('recognises a PNG by its signature', () => {
    expect(detectImageFormat(bytes(...PNG_SIGNATURE, 0x00, 0x00))).toBe('png');
  });

  it.each([
    ['JFIF', 0xe0],
    ['Exif', 0xe1],
    ['a file that starts with a quantisation table', 0xdb],
  ])('recognises a JPEG (%s)', (_name, marker) => {
    expect(detectImageFormat(bytes(0xff, 0xd8, 0xff, marker, 0x00))).toBe(
      'jpeg',
    );
  });

  it.each([
    ['a GIF', Buffer.from('GIF89a')],
    ['a WebP', Buffer.from('RIFF....WEBP')],
    ['a BMP', Buffer.from('BM......')],
    ['a PDF', Buffer.from('%PDF-1.7')],
    ['an HTML page', Buffer.from('<html><script>alert(1)</script></html>')],
    ['an empty file', Buffer.alloc(0)],
    ['a PNG cut short', bytes(...PNG_SIGNATURE.slice(0, 7))],
    [
      'a PNG signature with a wrong last byte',
      bytes(...PNG_SIGNATURE.slice(0, 7), 0x0b),
    ],
    ['two bytes of a JPEG', bytes(0xff, 0xd8)],
  ])('does not accept %s', (_name, buffer) => {
    expect(detectImageFormat(buffer)).toBeNull();
  });
});
