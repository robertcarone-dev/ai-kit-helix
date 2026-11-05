#!/usr/bin/env python3
"""Project delivery receipts: integration, portable evidence, reuse and queue timing."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import zipfile

from evidence_utils import ledger_check


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''): h.update(block)
    return h.hexdigest()


def save(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as stream: json.dump(data, stream, indent=2)


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()


def integration(root, branch, base):
    # Resolve once, so a concurrent merge cannot mix snapshots in the receipt.
    head = git(root, 'rev-parse', '--verify', '--end-of-options', branch+'^{commit}')
    target = git(root, 'rev-parse', '--verify', '--end-of-options', base+'^{commit}')
    unique = git(root, 'rev-list', target+'..'+head).splitlines()
    equivalent = {line[2:] for line in git(root, 'cherry', target, head).splitlines() if line.startswith('- ')}
    missing = [commit for commit in unique if commit not in equivalent]
    return {'integrated': not missing, 'branch': branch, 'head': head, 'base': base, 'baseHead': target,
            'patchEquivalent': sorted(equivalent), 'missing': missing,
            'scope': 'Commit ancestry or patch equivalence only; no runtime acceptance. Unmatched merge commits require explicit review.'}


def pack(source, output, revision, part_mib):
    if source.is_symlink(): raise ValueError('Symlinks are not evidence payloads')
    source, output = source.resolve(), output.resolve()
    if not source.is_dir() or output == source or source in output.parents:
        raise ValueError('Source must exist; output must be outside source')
    if not 1 <= part_mib <= 20: raise ValueError('part-mib must be 1..20')
    paths = sorted(source.rglob('*'))
    if source.is_symlink() or any(p.is_symlink() for p in paths): raise ValueError('Symlinks are not evidence payloads')
    files = [p for p in paths if p.is_file()]
    if not files: raise ValueError('No evidence files')
    output.mkdir(parents=True, exist_ok=False)
    manifest = {'schemaVersion': 1, 'revisionLabel': revision, 'payloads': [], 'parts': [],
                'reconstruct': 'Concatenate parts in listed order; verify archiveSha256, unzip, then verify every payload SHA256. Revision labels are supplied, not inferred.'}
    # Compress once into temporary storage; parts are each independently transportable.
    with tempfile.TemporaryDirectory() as temporary:
        archive = Path(temporary)/'evidence.zip'
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            for path in files:
                name = path.relative_to(source).as_posix()
                before = digest(path)
                z.write(path, name)
                if digest(path) != before: raise ValueError('Evidence changed during packaging: '+name)
                manifest['payloads'].append({'path': name, 'bytes': path.stat().st_size, 'sha256': before})
        # Verify archived bytes, not just source bytes (detect mid-copy writes).
        with zipfile.ZipFile(archive) as z:
            for entry in manifest['payloads']:
                with z.open(entry['path']) as stream:
                    h = hashlib.sha256()
                    for block in iter(lambda: stream.read(1024*1024), b''): h.update(block)
                if h.hexdigest() != entry['sha256']: raise ValueError('Archived bytes changed: '+entry['path'])
        manifest['archiveSha256'] = digest(archive)
        with archive.open('rb') as stream:
            index = 1
            while True:
                block = stream.read(part_mib*1024*1024)
                if not block: break
                name = f'evidence.zip.part{index:03d}'
                (output/name).write_bytes(block)
                manifest['parts'].append({'path': name, 'bytes': len(block), 'sha256': hashlib.sha256(block).hexdigest()})
                index += 1
    save(output/'manifest.json', manifest)
    return manifest


def verify_package(package):
    package = package.resolve()
    manifest = json.loads((package/'manifest.json').read_text())
    total = hashlib.sha256()
    names = set()
    for part in manifest['parts']:
        name = part['path']
        if not re.fullmatch(r'evidence\.zip\.part\d{3,}', name) or name in names:
            raise ValueError('Invalid or duplicate archive part')
        names.add(name)
        path = package/name
        if path.is_symlink() or path.stat().st_size != part['bytes'] or digest(path) != part['sha256']:
            raise ValueError('Archive part changed: '+name)
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024*1024), b''): total.update(block)
    if not names or total.hexdigest() != manifest['archiveSha256']: raise ValueError('Reconstruction hash differs')
    return manifest


def upload(root, issue, package, output, aikit):
    if not re.fullmatch(r'AK-\d+', issue): raise ValueError('Expected AK-N issue key')
    root, package = root.resolve(), package.resolve()
    manifest = verify_package(package)
    output.mkdir(parents=True, exist_ok=False)
    receipt = {'issue': issue, 'verified': [], 'complete': False}
    marker = root/'.aikit/lane.json'
    owner = Path(json.loads(marker.read_text())['owner']) if marker.exists() else root
    issue_dir = owner/'.aikit/assistant/issues'/issue
    try:
        expected_files = [(package/p['path'], p['sha256']) for p in manifest['parts']] + [(package/'manifest.json', digest(package/'manifest.json'))]
        for path, expected in expected_files:
            if digest(path) != expected: raise ValueError('Package changed before upload: '+path.name)
            metadata = json.loads((issue_dir/'issue.json').read_text())
            matches = [a for a in metadata['attachments'] if a['sha256'] == expected]
            if not matches:
                result = subprocess.run([aikit, 'board', 'attach', issue, str(path), '--cite', 'report', '--title', path.name],
                                        cwd=root, capture_output=True, text=True, timeout=120)
                if result.returncode: raise ValueError(result.stderr or result.stdout)
                metadata = json.loads((issue_dir/'issue.json').read_text())
                matches = [a for a in metadata['attachments'] if a['sha256'] == expected]
            if not matches: raise ValueError('Attachment not visible on consumer readback: '+path.name)
            entry = matches[-1]
            target = (issue_dir/'attachments'/entry['file']).resolve()
            if not target.is_relative_to((issue_dir/'attachments').resolve()) or digest(target) != expected:
                raise ValueError('Consumer attachment hash differs')
            receipt['verified'].append({'path': path.name, 'attachment': entry['id'], 'sha256': expected})
        receipt['complete'] = True
    except Exception as error:
        receipt['error'] = str(error)
        raise
    finally:
        save(output/'upload.json', receipt)
    return receipt


def timings(root):
    marker = root/'.aikit/lane.json'
    owner = Path(json.loads(marker.read_text())['owner']) if marker.exists() else root
    data = json.loads((owner/'.aikit/assistant/team/seats.json').read_text())
    now = datetime.now(timezone.utc)
    def stamp(value): return datetime.fromisoformat(value.replace('Z', '+00:00')) if value else None
    result = []
    for a in data['assignments']:
        requested, started, ended = [stamp(a.get(k)) for k in ('requestedAt','startedAt','endedAt')]
        result.append({'assignment': a['id'], 'item': a['item'], 'state': a['state'], 'runs': a.get('runs'),
                       'requestToLatestStartSeconds': (started-requested).total_seconds() if requested and started else None,
                       'queuedAgeSeconds': (now-requested).total_seconds() if requested and not started else None,
                       'latestRunSpanSeconds': ((ended or now)-started).total_seconds() if started and (ended or a['state']=='running') else None})
    return {'at': now.isoformat(), 'assignments': result, 'providerHolds': data.get('limitHolds', {}),
            'scope': 'Wall-clock spans, not model execution time. Resumed sessions can include earlier runs; request-to-latest-start is not pure queue time. No invented phase breakdown.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__); sub = parser.add_subparsers(dest='command', required=True)
    p=sub.add_parser('integration');p.add_argument('--project-root',type=Path,default=Path.cwd());p.add_argument('--branch',required=True);p.add_argument('--base',default='main');p.add_argument('--out',type=Path,required=True)
    p=sub.add_parser('pack');p.add_argument('--source',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--revision',required=True);p.add_argument('--part-mib',type=int,default=20)
    p=sub.add_parser('upload');p.add_argument('--project-root',type=Path,default=Path.cwd());p.add_argument('--issue',required=True);p.add_argument('--package',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--aikit',default='ai-kit')
    p=sub.add_parser('reuse');p.add_argument('--ledger',type=Path,required=True);p.add_argument('--inputs',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p=sub.add_parser('timings');p.add_argument('--project-root',type=Path,default=Path.cwd());p.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    try:
        if args.command=='integration': result=integration(args.project_root,args.branch,args.base)
        elif args.command=='pack': result=pack(args.source,args.out,args.revision,args.part_mib)
        elif args.command=='upload': result=upload(args.project_root,args.issue,args.package,args.out,args.aikit)
        elif args.command=='reuse': result=ledger_check(args.ledger,args.inputs)
        else: result=timings(args.project_root)
        if args.command not in ('pack','upload'): save(args.out,result)
        print(json.dumps(result,indent=2))
        return 1 if args.command=='integration' and not result['integrated'] else 0
    except (ValueError,KeyError,OSError,subprocess.SubprocessError) as error:
        print(json.dumps({'error':str(error)}),file=sys.stderr);return 1


if __name__=='__main__': sys.exit(main())
