import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { root, readConfig, adapterSettings, loadStep, sha } from './config.ts';
import { fixtureContract, createFixture } from './fixtures.ts';

export function fixtureCommand(command: string, pos: string[], options: Record<string, string>) {
  if (command === 'fixture-handoff') {
    if (pos.length || !options.recording || !options.notes || !options.out)
      throw new Error('fixture-handoff requires --recording, --notes and --out.');
    const installed = join(dirname(fileURLToPath(import.meta.url)), '../handoff.py');
    const script = existsSync(installed)
      ? installed
      : join(dirname(fileURLToPath(import.meta.url)), '../../workflows/handoff.py');
    const recording = resolve(root, options.recording);
    const viewports = existsSync(join(root, 'Tools/Helix/reference.json'))
      ? adapterSettings(root).viewports
      : {};
    const result = spawnSync(
      'python3',
      [
        script,
        recording,
        resolve(root, options.notes),
        resolve(root, options.out),
        JSON.stringify(viewports),
      ],
      { encoding: 'utf8' },
    );
    if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr.trim());
    return JSON.parse(result.stdout);
  }
  const { config } = readConfig();
  const fixtures = Object.entries(config.scenarios ?? {}).filter(
    ([, item]: any) => item.schemaVersion === 1 && item.feature,
  );
  if (command === 'fixture-list' && !pos.length)
    return {
      project: config.helix,
      viewports: config.viewports,
      contract: fixtureContract,
      scenarios: Object.keys(config.scenarios ?? {}),
      fixtures: fixtures.map(([id, item]: any) => ({
        id,
        feature: item.feature,
        label: item.label,
        viewport: item.viewport,
      })),
    };
  if (command === 'fixture-create' && !pos.length && options.spec)
    return createFixture(root, options.spec, config, loadStep);
  if (command !== 'fixture-record' || pos.length !== 1 || !options.out)
    throw new Error(
      'Use fixture-list, fixture-create --spec FILE, or fixture-record ID --out NEW_DIR.',
    );
  const fixture = fixtures.find(([id]) => id === pos[0])?.[1] as any;
  if (!fixture) throw new Error('Unknown fixture: ' + pos[0]);
  const out = resolve(root, options.out);
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(out); // Reserve before starting the browser. Keep partial runs for diagnosis.
  const session = randomUUID();
  const env = { ...process.env, HELIX_FIXTURE_SESSION: session };
  const run = (args: string[]) => {
    const result = spawnSync(
      process.execPath,
      [join(dirname(fileURLToPath(import.meta.url)), 'cli.ts'), ...args, '--project-root', root],
      { env, encoding: 'utf8', timeout: 145000, maxBuffer: 10000000 },
    );
    if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr.trim());
    return JSON.parse(result.stdout);
  };
  const owned = join(root, '.helix', 'fixture-sessions', session);
  try {
    const started = run(['start', '--viewport', fixture.viewport]);
    // The host froze the effective scenario, including expanded hook bytes, at startup.
    const frozen = JSON.parse(readFileSync(join(owned, 'launch.json'), 'utf8')).config.scenarios[
      pos[0]
    ];
    if (JSON.stringify(frozen) !== JSON.stringify(fixture))
      throw new Error('Fixture changed during startup; retry with the current revision.');
    const recorded = run(['record', pos[0], '--scenario', pos[0], '--after', 'stop', '--duration', '1', '--out', out]);
    if (
      recorded.errors.length ||
      recorded.configHash !== started.configHash ||
      recorded.scenario !== pos[0]
    )
      throw new Error(
        'Recording has browser errors or changed scenario/configuration; inspect motion.json.',
      );
    if (recorded.sha256 !== sha(readFileSync(join(out, 'motion.webm'))))
      throw new Error('Recording hash mismatch.');
    const identity = {
      id: pos[0],
      feature: fixture.feature,
      label: fixture.label,
      viewport: fixture.viewport,
      clipSha256: recorded.sha256,
    };
    writeFileSync(join(out, 'fixture.json'), JSON.stringify(identity, null, 2));
    return {
      ...identity,
      recording: out,
      state: recorded.state,
      receipt: join(out, 'motion.json'),
    };
  } catch (error) {
    throw new Error(String(error) + ' (session diagnostics: ' + owned + ')');
  } finally {
    if (existsSync(join(owned, 'connection.json'))) run(['stop']);
  }
}
