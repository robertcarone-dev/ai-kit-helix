import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function processExited(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid retained owner PID.');
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
    throw error;
  }
}

export function acquireProcessLock(lock: string, token: string) {
  // Python's standard-library flock protects the complete receipt replacement.
  // The OS releases it even if this process or the helper exits unexpectedly.
  const installed = fileURLToPath(new URL('../matrix_lock.py', import.meta.url));
  const helper = existsSync(installed) ? installed : fileURLToPath(new URL('../../workflows/matrix_lock.py', import.meta.url));
  const result = spawnSync('python3', [helper, lock, String(process.pid), token], {
    encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Cannot acquire ' + lock + ': ' + result.stderr.trim());
  return JSON.parse(result.stdout) as { recoverySessions: string[] };
}
