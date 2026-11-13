import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('playwright/package.json');
// Keep browser ownership independent of other tools and transient lane paths.
// A Helix-specific override is intentional; ambient Playwright settings belong to other tools.
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.HELIX_BROWSERS_PATH || join(homedir(), '.cache', 'ai-kit-helix', 'browsers', version);
