import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { PNG } from 'pngjs';
import { sha } from './config.ts';

export const previewBridge = readFileSync(new URL('./browser/preview-bridge.js', import.meta.url), 'utf8');
const operations = {
  list: { type: 'helix:request:cheats', reply: 'helix:cheats', capability: 'cheats' },
  run: { type: 'helix:request:runCheat', reply: 'helix:cheatResult', capability: 'cheats' },
  clip: { type: 'helix:request:clip', reply: 'helix:clip', capability: 'clip' },
  render: { type: 'helix:request:renderObject', reply: 'helix:renderObject', capability: 'renderObject' },
};
export function validateCheat(value: any) {
  if (!value || typeof value.name !== 'string' || !value.name.trim() || !value.args || typeof value.args !== 'object' || Array.isArray(value.args) || (value.sceneKey !== undefined && (typeof value.sceneKey !== 'string' || !value.sceneKey)))
    throw new Error('Cheat requires name, an args object, and an optional sceneKey.');
  return value;
}
export function validateNativeRequest(operation: string, value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Native request must be an object.');
  const keys = operation === 'clip' ? ['durationMs', 'frames', 'cheat'] : ['name', 'index', 'yaw', 'pitch', 'zoom', 'size', 'turntable', 'context'];
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error('Unknown native request field: ' + key);
  if (operation === 'clip') {
    if (!Number.isFinite(value.durationMs) || value.durationMs <= 0 || value.durationMs > 10000) throw new Error('Clip durationMs must be >0 and <=10000.');
    if (value.frames !== undefined && (!Number.isInteger(value.frames) || value.frames < 2 || value.frames > 16)) throw new Error('Clip frames must be 2..16.');
    if (value.cheat !== undefined) validateCheat(value.cheat);
  } else {
    if (typeof value.name !== 'string' || !value.name) throw new Error('Object render requires name.');
    for (const [key, min, max, integer] of [['index', 0, Number.MAX_SAFE_INTEGER, true], ['yaw', -360, 360, false], ['pitch', -89, 89, false], ['zoom', 0.1, 20, false], ['size', 64, 1024, true], ['turntable', 1, 12, true]] as const) {
      const n = value[key];
      if (n !== undefined && (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n)))) throw new Error('Invalid object render ' + key);
    }
    if (value.context !== undefined && typeof value.context !== 'boolean') throw new Error('Object render context must be boolean.');
  }
  return value;
}
export class NativePreviewTransportError extends Error {}
export async function nativeRequest(page: Page, operation: keyof typeof operations, args: any = {}) {
  let reply: any;
  try {
    reply = await page.evaluate(async (request) => (window as any).__helixCliPreview.request(request), { ...operations[operation], args, timeoutMs: operation === 'clip' ? args.durationMs + 20000 : 20000 });
  } catch (cause) {
    // No reply cannot prove whether a mutating action finished. The host must
    // retire this context before admitting another command.
    throw new NativePreviewTransportError('Native preview transport failed; the session must stop before retrying: ' + String(cause), { cause });
  }
  if (operation === 'list') {
    if (!Array.isArray(reply.cheats)) throw new Error('Malformed native Cheat list.');
  } else if (reply.ok !== true) throw new Error(`${reply.error ?? 'Malformed native reply'}${reply.refusal ? ' [refusal: ' + reply.refusal + ']' : ''}`);
  return reply;
}
export async function previewReading(page: Page) {
  return page.evaluate(() => (window as any).__helixCliPreview.reading());
}
/** Keep the native PNG unchanged; a diagnostic sheet is not a viewport capture. */
export function writeNativeCapture(out: string, operation: string, reply: any, metadata: any) {
  if (typeof reply.dataUrl !== 'string' || !reply.dataUrl.startsWith('data:image/png;base64,')) throw new Error('Native capture did not return a PNG.');
  const bytes = Buffer.from(reply.dataUrl.slice('data:image/png;base64,'.length), 'base64');
  const decoded = PNG.sync.read(bytes);
  const { dataUrl, ...result } = reply;
  const image = operation === 'clip' ? 'filmstrip.png' : 'object.png';
  const receipt = { schemaVersion: 1, kind: 'helix-native-' + operation, ...metadata, result, image, width: decoded.width, height: decoded.height, sha256: sha(bytes), nativeViewport: false, notes: ['Diagnostic native Helix output; not a Unity parity verdict. Frame times are observed wall-clock times, not deterministic game-time samples.'] };
  writeFileSync(join(out, image), bytes);
  writeFileSync(join(out, 'native.json'), JSON.stringify(receipt, null, 2));
  return { ...receipt, out, imagePath: join(out, image), receiptPath: join(out, 'native.json') };
}
