import type { Page } from 'playwright';
/** Chromium's fast, lossless PNG encoder. Pixel dimensions are still verified by callers. */
export async function nativePng(page: Page): Promise<Buffer> {
  const session = await page.context().newCDPSession(page);
  try {
    const size = page.viewportSize();
    if (!size) throw new Error('Native PNG requires an explicit viewport.');
    const result = await session.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      optimizeForSpeed: true,
      clip: {
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
        scale: 1,
      },
    });
    return Buffer.from(result.data, 'base64');
  } finally {
    await session.detach();
  }
}
