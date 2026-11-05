import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

// Resolve against this script so formatting also works outside the repository cwd.
const root = new URL('../', import.meta.url);
const check = process.argv.includes('--check');
const files = ['scripts/format.mjs'];
for (const directory of ['cli/src', 'cli/test']) {
  for (const name of readdirSync(new URL(`${directory}/`, root)).sort()) {
    if (name.endsWith('.ts')) files.push(`${directory}/${name}`);
  }
}

let changed = 0;
for (const file of files) {
  const path = fileURLToPath(new URL(file, root));
  const options = await resolveConfig(path);
  const original = readFileSync(path, 'utf8');
  let source = original;

  // Prettier treats String.raw as opaque text. These two templates contain
  // standalone JavaScript sent to the browser, so format their bodies as JS.
  if (file === 'cli/src/inspector.ts' || file === 'cli/src/ui-inspector.ts') {
    const match = /String\.raw`([^`]*)`/s.exec(source);
    if (!match || match[1].includes('${')) {
      throw new Error(`Expected one interpolation-free browser probe in ${file}`);
    }
    const probe = await format(match[1], { ...options, parser: 'babel' });
    // The caller embeds this as an expression: a trailing semicolon is invalid.
    const expression = probe.trimEnd().replace(/;$/, '');
    source = source.replace(match[0], () => `String.raw\`${expression}\``);
  }

  const formatted = await format(source, { ...options, filepath: path });
  if (formatted === original) continue;
  changed++;
  if (check) console.error(`Needs formatting: ${file}`);
  else {
    writeFileSync(path, formatted);
    console.log(`Formatted ${file}`);
  }
}

if (check && changed) process.exitCode = 1;
else console.log(check ? 'TypeScript formatting is consistent.' : 'Formatting complete.');
