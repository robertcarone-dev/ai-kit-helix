import './browser-environment.ts';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve('playwright/package.json')), 'cli.js');
const result = spawnSync(process.execPath, [cli, 'install', 'chromium', ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.signal) throw new Error(`Browser installation terminated by ${result.signal}`);
process.exitCode = result.status;
