#!/usr/bin/env python3
"""Hold a machine-wide capture permit until the owning process closes stdin."""
import fcntl
import json
import os
from pathlib import Path
import sys
import select
import signal
import tempfile
import time
from matrix_lock import process_exited


def reserve(path, owner):
    try:
        before = path.stat()
    except FileNotFoundError:
        before = None
    if before is not None:
        try:
            previous = json.loads(path.read_text())
            exited = process_exited(previous['pid'])
        except FileNotFoundError:
            return None
        except (ValueError, KeyError, TypeError):
            # A legacy writer may still be publishing. Never evict an unknown owner.
            return None
        if not exited:
            return None
        try:
            if path.stat().st_ino == before.st_ino:
                path.unlink()
        except FileNotFoundError:
            return None
    descriptor, staging = tempfile.mkstemp(prefix='.permit-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as output:
            json.dump({'pid': owner, 'helperPid': os.getpid()}, output)
        try:
            os.link(staging, path)  # Publish complete bytes without replacing a contender.
        except FileExistsError:
            return None
        return path.stat().st_ino
    finally:
        os.unlink(staging)


def hold(directory, owner):
    directory.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if select.select([sys.stdin], [], [], 0)[0]:
            if sys.stdin.buffer.read(1) != b'':
                raise ValueError('Permit input must remain empty until release.')
            return
        for slot in range(2):
            # The permanent guard serializes recovery; legacy clients see the receipt.
            path = directory / f'{slot}.lock'
            with (directory / f'{slot}.permit').open('a+') as guard:
                try:
                    fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    continue
                inode = reserve(path, owner)
                if inode is None:
                    continue
                try:
                    print(json.dumps({'slot': slot, 'path': str(path)}), flush=True)
                    sys.stdin.buffer.read(1)
                finally:
                    try:
                        if path.stat().st_ino == inode:
                            path.unlink()
                    except FileNotFoundError:
                        pass  # A legacy worker may have recovered an exited parent.
                return
        time.sleep(0.1)
    raise TimeoutError(f'Capture worker capacity unavailable after 30 seconds: {directory}. Inspect active owners and any incomplete legacy .lock receipts before retrying.')


def interrupted(signum, frame):
    raise SystemExit(1)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        hold(Path(sys.argv[1]), int(sys.argv[2]))
    except (OSError, ValueError, TimeoutError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
