import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyOutput, readConfig, root, sha } from './config.ts';
import { isDeepStrictEqual } from 'node:util';
import { visualOwner } from './visual-owner.ts';

function replay(project: string, plan: string) {
  const isolated = realpathSync(project);
  if (isolated === root || existsSync(join(isolated, 'Temp/UnityLockfile')))
    throw new Error('Supply a separate idle Unity project with the shared Editor helper.');
  const status = spawnSync('unity', ['status', '--project-path', isolated, '--format', 'json'], {
    encoding: 'utf8',
  });
  if (status.error) throw status.error;
  const inventory = JSON.parse(status.stdout);
  if (
    !(
      inventory.data?.count === 0 &&
      (status.status === 0 || inventory.errors?.some((e: any) => e.code === 'STATUS_NO_INSTANCES'))
    )
  )
    throw new Error('Could not establish that the selected Unity project is idle.');
  const processes = spawnSync('ps', ['-axww', '-o', 'command='], { encoding: 'utf8' });
  if (
    processes.status !== 0 ||
    processes.stdout
      .split('\n')
      .some(
        (line) =>
          /(?:^|\/)Unity(?:\s|$)/.test(line) &&
          [project, isolated, isolated.replace(/^\/private\/tmp\//, '/tmp/')].some((p) =>
            line.includes(p),
          ),
      )
  )
    throw new Error('Cannot establish an unused Unity project path from running processes.');
  const version = readFileSync(join(isolated, 'ProjectSettings/ProjectVersion.txt'), 'utf8').match(
    /^m_EditorVersion: (\S+)/m,
  );
  if (!version) throw new Error('Unity project has no declared Editor version.');
  const result = spawnSync(
    'unity',
    [
      'open',
      isolated,
      '--batchmode',
      '--wait',
      '--non-interactive',
      '--format',
      'json',
      '--editor-version',
      version[1],
      '--args',
      '-nographics -logFile Logs/helix-aligned-owner.log -executeMethod Helix.Comparison.AlignedAnimatorCapture.Start',
    ],
    { env: { ...process.env, HELIX_ANIMATOR_PLAN: plan }, encoding: 'utf8', timeout: 240000 },
  );
  if (result.error || result.status !== 0 || !existsSync(join(dirname(plan), 'receipt.json')))
    throw new Error(
      'Unity did not complete the aligned capture. Inspect ' +
        join(isolated, 'Logs/helix-aligned-owner.log') +
        ' ' +
        (result.error?.message ?? result.stderr),
    );
}

export function handoffOwner(archive: string, project: string, output: string) {
  const here = dirname(fileURLToPath(import.meta.url));
  const installed = join(here, '../handoff.py');
  const loaded = spawnSync(
    'python3',
    [
      existsSync(installed) ? installed : join(here, '../../workflows/handoff.py'),
      'read-alignment',
      archive,
    ],
    { encoding: 'utf8' },
  );
  if (loaded.error || loaded.status !== 0) throw loaded.error ?? new Error(loaded.stderr.trim());
  const plan = JSON.parse(loaded.stdout);
  const { config } = readConfig();
  const fixture = config.scenarios[plan.scenario];
  if (
    !fixture?.alignment ||
    ![plan.reference.project, plan.reference.name].includes(config.helix.project) ||
    ![plan.reference.variant, plan.reference.variantName].includes(config.helix.variant) ||
    sha(fixture.alignment.visible) !== plan.predicateSha256 ||
    plan.event !== fixture.alignment.event ||
    !isDeepStrictEqual(plan.unity, fixture.alignment.unity)
  )
    throw new Error('Handoff event and binding must match the registered receiving fixture.');
  const out = emptyOutput(output);
  const rel = relative(root, realpathSync(out));
  if (!rel || rel === '..' || rel.startsWith('../'))
    throw new Error('Choose an evidence directory inside the receiving checkout.');
  const planPath = join(out, 'plan.json');
  writeFileSync(planPath, JSON.stringify(plan, null, 2), { flag: 'wx' });
  const report = {
    handoff: basename(archive),
    handoffSha256: sha(readFileSync(archive)),
    event: plan.event,
    anchorMs: plan.anchorMs,
    picks: plan.picks,
  };
  if (plan.picks.some((p: any) => p.status === 'ready')) {
    replay(project, planPath);
    const receiptPath = join(out, 'receipt.json');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    if (receipt.planSha256 !== sha(readFileSync(planPath)))
      throw new Error('Unity receipt belongs to a different handoff plan.');
    const spec = { schemaVersion: 1, ...plan.unity, receipt: relative(root, receiptPath) };
    const specPath = join(out, 'spec.json');
    writeFileSync(specPath, JSON.stringify(spec, null, 2));
    const review = visualOwner(specPath, join(out, 'review')) as Record<string, any>;
    for (const pick of report.picks) {
      if (pick.status !== 'ready') continue;
      if (['stale', 'incomplete'].includes(review.status)) {
        pick.status = review.status;
        continue;
      }
      const snapshots = review.checkpoints.filter((c: any) => {
        const t = Number(c.label);
        return t >= pick.offsetMs && t <= pick.latestOffsetMs;
      });
      const clips = new Set<string>();
      let unique =
        snapshots.length > 0 &&
        Number(snapshots[0].label) === pick.offsetMs &&
        Number(snapshots.at(-1).label) === pick.latestOffsetMs;
      for (const snap of snapshots) {
        const active = snap.activeBindings.filter(
          (b: any) => b.layerWeight > 0 && b.clipWeight > 0,
        );
        for (const b of active) clips.add(b.clip.path);
        unique &&=
          active.length === 1 &&
          active[0].phase === 'current' &&
          active[0].clipWeight === 1 &&
          active[0].layerWeight === 1;
      }
      pick.status =
        unique && clips.size === 1 && !review.writes.length
          ? 'single-active-clip'
          : 'ownership-unresolved';
      pick.clips = [...clips];
      pick.sampleCount = snapshots.length;
    }
  }
  writeFileSync(join(out, 'alignment.json'), JSON.stringify(report, null, 2));
  return report;
}
