#!/usr/bin/env python3
"""Atomically acquire a matrix receipt under a crash-released POSIX file lock."""
import fcntl
import json
import os
from pathlib import Path
import re
import sys


def process_exited(pid):
    if type(pid) is not int or pid <= 0:
        raise ValueError('Invalid retained owner PID.')
    try:
        os.kill(pid, 0)
        return False
    except ProcessLookupError:
        return True


def acquire(path, pid, token):
    # Never unlink or replace the guard: every contender must lock the same inode.
    # Existing guards from the exclusive-file implementation are reusable as-is.
    guard_fd = os.open(str(path) + '.acquire', os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(guard_fd, 'r+') as guard:
        try:
            fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Matrix lock acquisition is in progress; retry after it finishes.') from None
        recovery_sessions = []
        if path.exists():
            owner = json.loads(path.read_text())
            if not process_exited(owner['pid']):
                raise RuntimeError('A live process owns the UI matrix lock.')
            # Receipts written before crash recovery had only pid and token.
            previous = owner.get('recoverySessions', [])
            if not isinstance(previous, list):
                raise ValueError('Invalid retained matrix session identities.')
            for session in [owner['token'], *previous]:
                if not isinstance(session, str) or not re.fullmatch(r'[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}', session):
                    raise ValueError('Invalid retained matrix session identity.')
                if session not in recovery_sessions:
                    recovery_sessions.append(session)
        if process_exited(pid):
            raise RuntimeError('The requesting matrix process has exited.')
        receipt = dict(pid=pid, token=token, recoverySessions=recovery_sessions)
        # A crash before replace leaves the old receipt intact. The next holder
        # overwrites any partial staging file while holding the same OS lock.
        staging = str(path) + '.next'
        staging_fd = os.open(staging, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
        with os.fdopen(staging_fd, 'w') as output:
            json.dump(receipt, output)
        os.replace(staging, path)
        return dict(recoverySessions=recovery_sessions)


if __name__ == '__main__':
    try:
        result = acquire(Path(sys.argv[1]), int(sys.argv[2]), sys.argv[3])
        print(json.dumps(result))
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
