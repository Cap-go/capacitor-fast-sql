import { expect, test } from 'bun:test';

import { decodeBinaryFrame, encodeBinaryFrame } from '../src/binary-frame';

test('binary frames preserve Unicode, scalar types, slices, empty BLOBs and null', () => {
  const bytes = new Uint8Array([99, 0, 255, 42, 88]).subarray(1, 4);
  const input = { statement: 'SELECT "世界"', params: [bytes, new Uint8Array(), null, true, 1.25, -7, ''] };
  expect(decodeBinaryFrame(encodeBinaryFrame(input))).toEqual(input);
});

test('version, lengths, attachment references and nesting are validated', () => {
  const original = encodeBinaryFrame({ value: new Uint8Array([1, 2]) });
  for (const bad of [original.slice(1), original.slice(0, -1), new Uint8Array([...original, 0])])
    expect(() => decodeBinaryFrame(bad)).toThrow();
  const version = original.slice();
  version[3] = 50;
  expect(() => decodeBinaryFrame(version)).toThrow('version');
  for (const $blob of [
    [-1, 1],
    [0, 999],
    [0.5, 0],
    [0, -1],
    [true, 0],
  ]) {
    expect(() => decodeBinaryFrame(encodeBinaryFrame({ $blob }))).toThrow();
  }
  let nested: unknown = null;
  for (let i = 0; i < 40; i++) nested = [nested];
  expect(() => encodeBinaryFrame(nested)).toThrow('limits');
  expect(() => encodeBinaryFrame({ value: Infinity })).toThrow('Non-finite');
});

test('raw bytes do not appear as base64 and metadata cannot mutate prototypes', () => {
  const frame = encodeBinaryFrame(JSON.parse('{"__proto__":{"safe":1},"value":0}'));
  const result = decodeBinaryFrame(frame);
  expect(result).toHaveProperty('__proto__');
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  const blob = new Uint8Array(65536);
  expect(encodeBinaryFrame({ value: blob }).byteLength).toBeLessThan(65600);
});

test('shared cross-language golden frame decodes exactly', async () => {
  const frame = new Uint8Array(
    await Bun.file('ios/Tests/CapgoCapacitorFastSqlPluginTests/Fixtures/binary-v1.bin').arrayBuffer(),
  );
  expect(decodeBinaryFrame(frame)).toEqual({
    statement: 'SELECT ? AS bytes, ? AS empty, ? AS fraction, ? AS text',
    params: [new Uint8Array([0, 1, 255]), new Uint8Array(), 1.25, '😀'],
  });
});
