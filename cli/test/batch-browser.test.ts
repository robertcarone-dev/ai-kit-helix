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

test('native PNG preserves a held canvas without resizing the page', { skip }, async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  try {
    const page = await browser.newPage({ viewport: { width: 585, height: 1266 }, deviceScaleFactor: 1 });
    await page.goto('data:text/html,<!doctype html><html></html>');
    await page.setContent('<style>*{margin:0;padding:0}html,body{width:100%;height:100%;overflow:hidden;background:#000}canvas{position:absolute;width:100%;height:100%}</style><canvas></canvas>');
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
      resize();
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#245a89';
      context.fillRect(0, 0, canvas.width, canvas.height);
      // Like a sleeping game: resize clears the backing store, but no update redraws it.
      (window as any).captureResizes = [];
      window.addEventListener('resize', () => {
        (window as any).captureResizes.push([innerWidth, innerHeight]);
        resize();
      });
    });
    const png = PNG.sync.read(await nativePng(page));
    assert.equal(png.width, 585);
    assert.equal(png.height, 1266);
    assert.deepEqual(await page.evaluate(() => (window as any).captureResizes), []);
    for (let i = 0; i < png.data.length; i += 4)
      assert.deepEqual([...png.data.subarray(i, i + 4)], [36, 90, 137, 255]);
  } finally {
    await browser.close();
  }
});
