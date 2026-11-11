/** Inspect external PNG dimensions before allocating decoded pixels. */
export function pngDimensions(bytes: Buffer) {
  if (bytes.length < 33 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a || bytes.readUInt32BE(8) !== 13 || bytes.readUInt32BE(12) !== 0x49484452)
    throw new Error('Invalid PNG header.');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16777216)
    throw new Error('PNG exceeds decoded image limits (8192 pixels per side, 16777216 pixels per image).');
  return { width, height };
}
export const evidencePixelLimit = 33554432;
