/** Version 1 frame: FSQ1, uint32-LE metadata length, uint32-LE attachment length. */
export const BINARY_CONTENT_TYPE = 'application/vnd.capgo.fast-sql.v1+binary';
export const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_ATTACHMENTS = 4096;
const HEADER_BYTES = 12;
const magic = [70, 83, 81, 49];

export function encodeBinaryFrame(value: unknown): Uint8Array<ArrayBuffer> {
  const attachments: Uint8Array[] = [];
  let size = 0;
  let nodes = 0;
  const encode = (item: unknown, depth: number): unknown => {
    if (++nodes > 100000 || depth > 32) throw new Error('Binary metadata exceeds nesting or node limits');
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Non-finite binary protocol number');
    if (item instanceof Uint8Array) {
      if (attachments.length >= MAX_ATTACHMENTS || size + item.byteLength > MAX_FRAME_BYTES - HEADER_BYTES)
        throw new Error('Binary attachments exceed protocol limits');
      const reference = { $blob: [size, item.byteLength] };
      attachments.push(item);
      size += item.byteLength;
      return reference;
    }
    if (Array.isArray(item)) return item.map((value: unknown) => encode(value, depth + 1));
    if (item && typeof item === 'object') {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        throw new Error('Unsupported binary metadata object');
      return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, encode(value, depth + 1)]));
    }
    return item;
  };
  const json = JSON.stringify(encode(value, 0));
  if (json === undefined) throw new Error('Missing binary metadata');
  const metadata = new TextEncoder().encode(json);
  const length = HEADER_BYTES + metadata.byteLength + size;
  if (metadata.byteLength > MAX_METADATA_BYTES || length > MAX_FRAME_BYTES)
    throw new Error('Binary frame exceeds protocol limits');
  const frame = new Uint8Array(length);
  frame.set(magic);
  const view = new DataView(frame.buffer);
  view.setUint32(4, metadata.byteLength, true);
  view.setUint32(8, size, true);
  frame.set(metadata, HEADER_BYTES);
  let offset = HEADER_BYTES + metadata.byteLength;
  for (const attachment of attachments) {
    frame.set(attachment, offset);
    offset += attachment.byteLength;
  }
  return frame;
}

export function decodeBinaryFrame(frame: Uint8Array): unknown {
  if (
    frame.length < HEADER_BYTES ||
    frame.length > MAX_FRAME_BYTES ||
    magic.some((byte, index) => frame[index] !== byte)
  ) {
    throw new Error('Invalid binary frame version or length');
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const metadataLength = view.getUint32(4, true);
  const payloadLength = view.getUint32(8, true);
  const payloadOffset = HEADER_BYTES + metadataLength;
  if (metadataLength === 0 || metadataLength > MAX_METADATA_BYTES || payloadOffset + payloadLength !== frame.length) {
    throw new Error('Invalid binary frame lengths');
  }
  const metadata: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(frame.subarray(HEADER_BYTES, payloadOffset)),
  );
  let nodes = 0;
  let blobs = 0;
  let referencedBytes = 0;
  const decode = (value: unknown, depth: number): unknown => {
    if (++nodes > 100000 || depth > 32) throw new Error('Binary metadata exceeds nesting or node limits');
    if (Array.isArray(value)) return value.map((item: unknown) => decode(item, depth + 1));
    if (value === null || typeof value !== 'object') return value;
    if ('$blob' in value && Object.keys(value).length === 1) {
      const reference = value.$blob;
      if (!Array.isArray(reference) || reference.length !== 2) throw new Error('Invalid binary attachment reference');
      const [offset, length]: unknown[] = reference;
      if (
        typeof offset !== 'number' ||
        typeof length !== 'number' ||
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length < 0 ||
        offset + length > payloadLength
      ) {
        throw new Error('Binary attachment is outside its frame');
      }
      referencedBytes += length;
      if (++blobs > MAX_ATTACHMENTS || referencedBytes > MAX_FRAME_BYTES)
        throw new Error('Decoded attachments exceed protocol limits');
      return frame.slice(payloadOffset + offset, payloadOffset + offset + length);
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item, depth + 1)]));
  };
  return decode(metadata, 0);
}
