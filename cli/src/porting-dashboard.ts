import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dashboardLimit, readDashboard } from './porting-dashboard-format.ts';

export function portingDashboard(root: string, project: string, spec?: string) {
  const path = join(root, '.helix', 'porting-dashboard.json');
  if (spec === undefined && !existsSync(path)) return { status: 'not-reported', project, path, action: 'Publish a snapshot with workbench dashboard --spec FILE.' };
  const input = spec === undefined ? path : spec;
  if (statSync(input).size > dashboardLimit) throw new Error('Dashboard exceeds 1 MiB.');
  const raw = JSON.parse(readFileSync(input, 'utf8'));
  // Reports are complete snapshots. The CLI stamps publication time, never infers porting success.
  const report = readDashboard(spec === undefined ? raw : { ...raw, reportedUtc: new Date().toISOString() }, project);
  if (spec !== undefined) {
    const bytes = JSON.stringify(report, null, 2) + '\n';
    if (Buffer.byteLength(bytes) > dashboardLimit) throw new Error('Dashboard exceeds 1 MiB.');
    mkdirSync(join(root, '.helix'), { recursive: true });
    const temporary = path + '.' + randomUUID() + '.tmp';
    try { writeFileSync(temporary, bytes, { flag: 'wx' }); renameSync(temporary, path); }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  return { status: 'reported', path, report };
}
