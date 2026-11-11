// Evidence validation shared verbatim between the CLI and project mod.
export type EvidenceFile = { path: string; sha256: string; type: 'png' | 'json'; data: string; width?: number; height?: number };
export type Bundle = { format: 'helix-workbench-evidence'; version: 1; createdUtc: string; source: string; files: EvidenceFile[]; skipped: string[] };

export type Observation = { value: string | null; basis: string };
export type Inspection = {
  schemaVersion: 1; kind: 'helix-render-inspection'; id: string;
  reviewCaseId?: string;
  coordinateSpace?: 'native-top-left-pixels';
  images: { reference: string; candidate: string }; createdUtc: string; scope: string;
  rows: { property: string; reference: Observation; candidate: Observation }[];
  gaps: string[]; next: string;
  relatedTrace: null | { feature: string; pass: string; active: boolean; property: string; scope: string };
};
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const observation = (value: any) => value && (value.value === null || typeof value.value === 'string') && typeof value.basis === 'string' && (value.basis !== 'not-applicable' || value.value === null);
export function validateRenderInspection(value: any): asserts value is Inspection {
  if (!value || value.schemaVersion !== 1 || value.kind !== 'helix-render-inspection' || typeof value.id !== 'string' || !value.id || !hash(value.images?.reference) || !hash(value.images?.candidate) || typeof value.createdUtc !== 'string' || typeof value.scope !== 'string' || typeof value.next !== 'string' || !Array.isArray(value.rows) || value.rows.length > 100 || !value.rows.every((row: any) => row && typeof row.property === 'string' && observation(row.reference) && observation(row.candidate)) || !Array.isArray(value.gaps) || !value.gaps.every((gap: unknown) => typeof gap === 'string'))
    throw new Error('Invalid render inspection report. Regenerate it with helix render-inspect.');
  if (value.coordinateSpace !== undefined && value.coordinateSpace !== 'native-top-left-pixels') throw new Error('Unsupported rendering coordinates. Regenerate with helix render-inspect.');
  if (value.reviewCaseId !== undefined && (typeof value.reviewCaseId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.reviewCaseId))) throw new Error('Invalid rendering review case ID.');
  const bounds = value.rows.find((row: any) => row.property === 'Bounds');
  capturedBounds(bounds?.reference); capturedBounds(bounds?.candidate);
  if (value.relatedTrace !== null && (!value.relatedTrace || !['feature', 'pass', 'property', 'scope'].every(key => typeof value.relatedTrace[key] === 'string') || typeof value.relatedTrace.active !== 'boolean'))
    throw new Error('Invalid related render trace summary.');
}
export type Bounds = { x: number; y: number; width: number; height: number };
export function capturedBounds(observation: Observation | undefined): Bounds | null {
  if (!observation || observation.value === null || !observation.basis.startsWith('captured ')) return null;
  let value: any;
  try { value = JSON.parse(observation.value); } catch { throw new Error('Invalid captured bounds. Regenerate with helix render-inspect.'); }
  if (!value || !['x', 'y', 'width', 'height'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key])) || value.width < 0 || value.height < 0 || !Number.isFinite(value.x + value.width) || !Number.isFinite(value.y + value.height))
    throw new Error('Invalid captured bounds. Regenerate with helix render-inspect.');
  return value;
}

const limit = 48 * 1024 * 1024;

export async function readEvidence(text: string): Promise<Bundle> {
  if (text.length > limit) throw new Error('Bundle exceeds 48 MiB. Package a smaller evidence directory.');
  const bundle = JSON.parse(text);
  if (!bundle || bundle.format !== 'helix-workbench-evidence' || bundle.version !== 1 || typeof bundle.source !== 'string' || typeof bundle.createdUtc !== 'string' || !Array.isArray(bundle.files) || !bundle.files.length || bundle.files.length > 250 || !Array.isArray(bundle.skipped) || !bundle.skipped.every((p: unknown) => typeof p === 'string'))
    throw new Error('Expected a Helix Workbench evidence bundle, version 1.');
  const paths = new Set<string>();
  let pixels = 0;
  for (const file of bundle.files) {
    if (!file || typeof file.path !== 'string' || !file.path || paths.has(file.path) || !['png', 'json'].includes(file.type) || typeof file.data !== 'string' || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256))
      throw new Error('Invalid or duplicate evidence entry.');
    paths.add(file.path);
    let bytes: Uint8Array<ArrayBuffer>;
    if (file.type === 'png') {
      bytes = Uint8Array.from(atob(file.data), c => c.charCodeAt(0));
      const header = new DataView(bytes.buffer);
      if (bytes.length < 33 || header.getUint32(8) !== 13 || header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a || header.getUint32(12) !== 0x49484452 || !Number.isInteger(file.width) || !Number.isInteger(file.height) || file.width <= 0 || file.height <= 0 || file.width !== header.getUint32(16) || file.height !== header.getUint32(20))
        throw new Error(`Invalid PNG dimensions: ${file.path}`);
      if (file.width > 8192 || file.height > 8192 || file.width * file.height > 16777216)
        throw new Error(`PNG exceeds decoded image limits (8192 pixels per side, 16777216 pixels per image): ${file.path}`);
      pixels += file.width * file.height;
      if (pixels > 33554432) throw new Error('Bundle exceeds decoded image budget (33554432 total pixels).');
    } else {
      const report = JSON.parse(file.data);
      if (report?.kind === 'helix-render-inspection' && report.schemaVersion === 1) validateRenderInspection(report);
      bytes = new TextEncoder().encode(file.data);
    }
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(n => n.toString(16).padStart(2, '0')).join('');
    if (digest !== file.sha256) throw new Error(`Hash mismatch: ${file.path}`);
  }
  return bundle;
}
