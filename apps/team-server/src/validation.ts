import { inflateSync } from 'node:zlib';
import type { CreateTeamVersion, TeamEvidence, TeamLayer } from '../../../packages/team-protocol/src/index';
import { TeamError } from './store';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
function invalid(message: string): never { throw new TeamError('INVALID_INPUT', message); }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('JSON object required');
  return value as Record<string, unknown>;
}
export function text(value: unknown, name: string, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max) invalid(`${name} must be text of at most ${max} characters`);
  if (required && !value.trim()) invalid(`${name} cannot be empty`);
  return value.trim();
}
export function email(value: unknown) {
  const result = text(value, 'Email', 254, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) invalid('Valid email required');
  return result;
}
export function password(value: unknown) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) invalid('Password must contain 12 to 128 characters');
  return value;
}
export function operationId(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(value)) invalid('Operation ID must contain 8 to 128 letters, numbers, dashes or underscores');
  return value;
}
export function expectedHash(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid('Expected version hash required');
  return value;
}
function numeric(value: unknown, name: string, nonnegative = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e7 || (nonnegative && value < 0)) invalid(`Invalid ${name}`);
  return value;
}
export function anchor(value: unknown): { x: number; y: number } | undefined {
  if (value === undefined) return undefined;
  const item = object(value); const x = numeric(item.x, 'anchor x', true); const y = numeric(item.y, 'anchor y', true);
  if (x > 1 || y > 1) invalid('Comment anchor must lie inside normalized design bounds');
  return { x, y };
}
function dimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 32_000_000) invalid('Image dimensions exceed the 8192 pixel / 32 megapixel limit');
  return { width, height };
}
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function pngDimensions(bytes: Buffer) {
  if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) invalid('PNG signature does not match the image type');
  let width = 0, height = 0, bits = 0, channels = 0, color = 0, interlace = 0, ended = false, palette = false;
  const imageChunks: Buffer[] = [];
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) invalid('Truncated PNG chunk');
    const length = bytes.readUInt32BE(offset); const end = offset + length + 12;
    if (end > bytes.length) invalid('Truncated PNG data');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) invalid('Invalid PNG checksum');
    const chunk = bytes.subarray(offset + 8, end - 4);
    if (offset === 8 && type !== 'IHDR') invalid('PNG header required');
    if (type === 'IHDR') {
      if (width || length !== 13) invalid('Invalid PNG header');
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); dimensions(width, height);
      bits = chunk[8]; color = chunk[9]; channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
      const depths = ({ 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] } as Record<number, number[]>)[color];
      if (!depths?.includes(bits) || chunk[10] !== 0 || chunk[11] !== 0 || chunk[12] > 1) invalid('Unsupported PNG encoding');
      interlace = chunk[12];
    } else if (type === 'PLTE') {
      if (!length || length % 3 !== 0 || length > 768) invalid('Invalid PNG palette'); palette = true;
    } else if (['acTL', 'fcTL', 'fdAT'].includes(type)) invalid('Animated PNG is not supported for immutable screenshots');
    else if (type === 'IDAT') imageChunks.push(chunk);
    else if (type === 'IEND') {
      if (length !== 0 || end !== bytes.length) invalid('Invalid PNG end marker'); ended = true;
    } else if (type[0] === type[0].toUpperCase()) invalid('Unsupported critical PNG chunk');
    offset = end;
  }
  if (!ended || !imageChunks.length || (color === 3 && !palette)) invalid('PNG pixel data missing');
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const rows: { bytes: number; count: number }[] = [];
  let expected = 0;
  for (const [x, y, dx, dy] of passes) {
    const passWidth = width <= x ? 0 : Math.ceil((width - x) / dx); const passHeight = height <= y ? 0 : Math.ceil((height - y) / dy);
    if (!passWidth || !passHeight) continue;
    const rowBytes = Math.ceil(passWidth * bits * channels / 8) + 1;
    rows.push({ bytes: rowBytes, count: passHeight }); expected += rowBytes * passHeight;
  }
  if (expected > 128 * 1024 * 1024) invalid('Decoded PNG exceeds memory limit');
  let raw: Buffer;
  try { raw = inflateSync(Buffer.concat(imageChunks), { maxOutputLength: expected + 1 }); }
  catch { invalid('Invalid compressed PNG pixels'); }
  if (raw!.length !== expected) invalid('PNG pixel dimensions do not match header');
  let position = 0;
  for (const row of rows) for (let i = 0; i < row.count; i++) {
    if (raw![position] > 4) invalid('Invalid PNG scanline filter'); position += row.bytes;
  }
  return { width, height };
}
function jpegDimensions(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) invalid('Invalid JPEG signature or end marker');
  let width = 0, height = 0, scan = false, offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) invalid('Invalid JPEG marker');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) break;
    if (marker === 0xd8 || marker === 0 || marker === undefined) invalid('Invalid JPEG marker');
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) invalid('Truncated JPEG segment');
    const size = bytes.readUInt16BE(offset); if (size < 2 || offset + size > bytes.length) invalid('Truncated JPEG segment');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (size < 8 || bytes[offset + 2] !== 8) invalid('Unsupported JPEG frame');
      const frameHeight = bytes.readUInt16BE(offset + 3); const frameWidth = bytes.readUInt16BE(offset + 5);
      if (width && (width !== frameWidth || height !== frameHeight)) invalid('JPEG frames disagree');
      width = frameWidth; height = frameHeight; dimensions(width, height);
      const components = bytes[offset + 7]; if (![1, 3, 4].includes(components) || size !== 8 + components * 3) invalid('Invalid JPEG component table');
    }
    offset += size;
    if (marker === 0xda) {
      scan = true; const start = offset;
      while (offset < bytes.length - 1) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        const next = bytes[offset + 1];
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { offset += 2; continue; }
        if (next === 0xff) { offset++; continue; }
        break;
      }
      if (offset === start) invalid('JPEG scan is empty');
    }
  }
  if (!width || !scan || offset !== bytes.length) invalid('JPEG frame or scan data missing');
  return dimensions(width, height);
}
function webpDimensions(bytes: Buffer) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) invalid('Invalid WebP container');
  let width = 0, height = 0; let declared: { width: number; height: number } | undefined;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) invalid('Truncated WebP chunk');
    const type = bytes.toString('ascii', offset, offset + 4); const size = bytes.readUInt32LE(offset + 4); const end = offset + 8 + size;
    if (end > bytes.length) invalid('Truncated WebP pixel data'); const frame = bytes.subarray(offset + 8, end);
    if (type === 'VP8X') {
      if (size !== 10 || (frame[0] & 2)) invalid('Animated WebP is not supported for immutable screenshots');
      declared = dimensions(frame.readUIntLE(4, 3) + 1, frame.readUIntLE(7, 3) + 1);
    } else if (type === 'VP8 ') {
      if (width || size < 11 || (frame[0] & 1) || !frame.subarray(3, 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) invalid('Invalid WebP VP8 frame');
      width = frame.readUInt16LE(6) & 0x3fff; height = frame.readUInt16LE(8) & 0x3fff;
    } else if (type === 'VP8L') {
      if (width || size < 6 || frame[0] !== 0x2f || (frame[4] & 0xe0)) invalid('Invalid WebP lossless frame');
      const packed = frame.readUInt32LE(1); width = (packed & 0x3fff) + 1; height = ((packed >>> 14) & 0x3fff) + 1;
    } else if (type === 'ANIM' || type === 'ANMF') invalid('Animated WebP is not supported');
    offset = end + (size % 2);
    if (offset > bytes.length) invalid('Truncated WebP padding');
  }
  dimensions(width, height);
  if (declared && (declared.width !== width || declared.height !== height)) invalid('WebP canvas dimensions do not match its raster');
  return { width, height };
}
export function raster(value: unknown) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 32) invalid('Image exceeds 10 MiB');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) invalid('A base64 PNG, JPEG or WebP screenshot is required');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== match[2]) invalid('Invalid image encoding or size');
  let size: { width: number; height: number };
  try { size = match[1] === 'png' ? pngDimensions(bytes) : match[1] === 'jpeg' ? jpegDimensions(bytes) : webpDimensions(bytes); }
  catch (error) { if (error instanceof TeamError) throw error; invalid('Malformed raster screenshot'); }
  return { imageDataUrl: value, ...size! };
}
export function versionInput(value: unknown) {
  const body = object(value);
  const title = text(body.title, 'Title', 160, true); const summary = text(body.summary ?? '', 'Summary', 6000);
  const image = raster(body.imageDataUrl); const diff = text(body.diff ?? '', 'Diff', 60000);
  let sourceUrl: string | undefined;
  if (body.sourceUrl !== undefined && body.sourceUrl !== '') {
    sourceUrl = text(body.sourceUrl, 'Source URL', 2000, true);
    let url: URL; try { url = new URL(sourceUrl); } catch { invalid('Source URL must be an HTTPS link'); }
    if (url!.protocol !== 'https:' || url!.username || url!.password) invalid('Source URL must be an HTTPS link without credentials');
  }
  const layersValue = body.layers ?? []; const evidenceValue = body.evidence ?? [];
  if (!Array.isArray(layersValue) || layersValue.length > 1000) invalid('At most 1000 layers are allowed');
  const ids = new Set<string>();
  const layers: TeamLayer[] = layersValue.map(value => {
    const item = object(value); const bounds = object(item.bounds); const id = text(item.id, 'Layer ID', 160, true);
    if (ids.has(id)) invalid('Layer IDs must be unique'); ids.add(id);
    return { id, name: text(item.name, 'Layer name', 160, true), bounds: {
      x: numeric(bounds.x, 'layer x'), y: numeric(bounds.y, 'layer y'), w: numeric(bounds.w, 'layer width', true), h: numeric(bounds.h, 'layer height', true),
    } };
  });
  if (!Array.isArray(evidenceValue) || evidenceValue.length > 100) invalid('At most 100 evidence records are allowed');
  const evidence: TeamEvidence[] = evidenceValue.map(value => {
    const item = object(value); if (typeof item.passed !== 'boolean') invalid('Evidence passed flag must be boolean');
    return { name: text(item.name, 'Evidence name', 160, true), passed: item.passed as boolean, detail: text(item.detail, 'Evidence detail', 6000) };
  });
  const normalized: Omit<CreateTeamVersion, 'operationId'> & { width: number; height: number; layers: TeamLayer[]; evidence: TeamEvidence[]; diff: string } = {
    title, summary, ...image, layers, diff, evidence, ...(sourceUrl ? { sourceUrl } : {}),
  };
  return normalized;
}
