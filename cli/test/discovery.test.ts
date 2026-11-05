import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { localUrl, validateStep, readConfig, emptyOutput, loadStep, sha } from '../src/config.ts';
import { compare } from '../src/compare.ts';
test('WebM receipt reads actual encoded dimensions', async () => {
  const { webmDimensions } = await import('../src/video.ts');
  const video = Buffer.from([0xe0, 0x88, 0xb0, 0x82, 0x02, 0x48, 0xba, 0x82, 0x04, 0xf2]);
  assert.deepEqual(webmDimensions(video), { width: 584, height: 1266 });
  assert.throws(() => webmDimensions(Buffer.from([0])));
});

test('Helix selection resolves exact identities and constructs explicit variant preview', async () => {
  const { selectProject, serviceUrl } = await import('../src/discovery.ts');
  const p = {
    slug: 'cans',
    name: 'Cans',
    devUrl: '/preview/cans/',
    rootPath: '/local/source',
    variantsDir: 'src/variants',
    variants: [{ key: 'Default', name: 'Main', scenes: ['Game'] }],
  };
  const selected = selectProject(
    [p],
    { project: 'Cans', variant: 'Main', query: { quality: 0, variant: 'wrong' } },
    'http://localhost:47600',
  );
  assert.equal(selected.variant, 'Default');
  assert.equal(selected.sourceRoot, '/local/source');
  assert.equal(selected.url, 'http://localhost:47600/preview/cans/?quality=0&variant=Default');
  assert.throws(
    () => selectProject([p], { project: 'missing', variant: 'Main' }, 'http://localhost'),
    /not found/,
  );
  assert.throws(
    () => selectProject([p], { project: 'cans', variant: 'unknown' }, 'http://localhost'),
    /Available keys/,
  );
  assert.throws(
    () =>
      selectProject(
        [p, { ...p, slug: 'other' }],
        { project: 'Cans', variant: 'Main' },
        'http://localhost',
      ),
    /ambiguous/,
  );
  assert.throws(
    () =>
      selectProject(
        [{ ...p, devUrl: 'https://example.com/preview/cans/' }],
        { project: 'cans', variant: 'Main' },
        'http://localhost',
      ),
    /invalid preview/,
  );
  assert.throws(() => serviceUrl({ helix: { url: 'https://example.com' } }), /loopback/);
});

test('discovery keeps read-only failures and authentication failures actionable', async () => {
  const { discover } = await import('../src/discovery.ts');
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    };
    await assert.rejects(
      discover({ helix: { project: 'cans', variant: 'Default' } }),
      /fetch failed/,
    );
    globalThis.fetch = async () => new Response('{}', { status: 401 });
    await assert.rejects(
      discover({ helix: { project: 'cans', variant: 'Default' } }, true),
      /HTTP 401/,
    );
    globalThis.fetch = async () => new Response('{"unexpected":true}');
    await assert.rejects(
      discover({ helix: { project: 'cans', variant: 'Default' } }),
      /Unexpected Helix/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
