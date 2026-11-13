import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('playwright/package.json');
const moduleUrl = new URL('../src/playwright.ts', import.meta.url).href;
function browserPath(override?: string) {
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '/foreign-atom-cache' };
  delete env.HELIX_BROWSERS_PATH;
  if (override) env.HELIX_BROWSERS_PATH = override;
  return execFileSync(process.execPath, ['--input-type=module', '-e', `const { chromium } = await import(${JSON.stringify(moduleUrl)}); console.log(chromium.executablePath())`], { env, encoding: 'utf8' }).trim();
}
test('Helix isolates browser resolution from ambient Playwright cache settings', () => {
  assert.ok(browserPath().startsWith(join(homedir(), '.cache', 'ai-kit-helix', 'browsers', version) + '/'));
});
test('Helix supports an explicit dedicated cache including paths with spaces', () => {
  assert.ok(browserPath('/tmp/helix browser cache').startsWith('/tmp/helix browser cache/'));
});
