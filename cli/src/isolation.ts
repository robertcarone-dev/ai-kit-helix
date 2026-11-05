import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';

/** Standalone worktrees opt in explicitly; the developer checkout cannot self-certify. */
export function isolatedWorkspace(root: string) {
  if (existsSync(join(root, '.aikit/lane.json'))) return true;
  const marker = join(root, '.helix/isolated-worktree.json');
  if (!existsSync(marker)) return false;
  const m = JSON.parse(readFileSync(marker, 'utf8'));
  if (
    m.schemaVersion !== 1 ||
    m.kind !== 'standalone-comparison' ||
    realpathSync(m.projectRoot) !== realpathSync(root)
  )
    throw new Error('Invalid standalone comparison identity.');
  const git = readFileSync(join(root, '.git'), 'utf8').trim();
  if (!git.startsWith('gitdir: '))
    throw new Error('Standalone comparisons require a linked Git worktree.');
  const gitdir = resolve(root, git.slice(8));
  if (
    realpathSync(readFileSync(join(gitdir, 'gitdir'), 'utf8').trim()) !==
    realpathSync(join(root, '.git'))
  )
    throw new Error('Git worktree backlink does not match.');
  return true;
}
