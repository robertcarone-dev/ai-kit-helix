import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { nativePng } from '../src/png.ts';
import { resetFixture } from '../src/batch.ts';
const skip = process.env.HELIX_BROWSER_TESTS !== '1';
test('fast native PNG preserves all pixels and native dimensions', { skip }, async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 585, height: 1266 },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      '<style>body{margin:0;background:#245a89}div{width:301px;height:613px;background:linear-gradient(red,blue);border:7px solid white}</style><div></div>',
    );
    const a = PNG.sync.read(await page.screenshot()),
      b = PNG.sync.read(await nativePng(page));
    assert.equal(b.width, 585);
    assert.equal(b.height, 1266);
    assert.deepEqual(b.data, a.data);
  } finally {
    await browser.close();
  }
});
test('warm fixture waits through previous-ready scene transition', { skip }, async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
  });
  try {
    const page = await browser.newPage();
    await page.evaluate(() => {
      (window as any).fixtureState = { generation: 0, ready: true };
    });
    const adapter = {
      reset:
        '()=>{window.previousGeneration=window.fixtureState.generation;setTimeout(()=>{window.fixtureState={generation:1,ready:true};},150)}',
      ready:
        '()=>window.fixtureState.generation!==window.previousGeneration && window.fixtureState.ready',
    };
    await resetFixture(page, {}, 1, adapter);
    assert.equal(await page.evaluate(() => (window as any).fixtureState.generation), 1);
  } finally {
    await browser.close();
  }
});
