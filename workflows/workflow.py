#!/usr/bin/env python3
"""Project-local evidence, capture planning and isolated EditMode test utilities."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
try:
    import pwd
except ImportError:
    pwd = None
import xml.etree.ElementTree as ET

from evidence_utils import digest, read, inside, fresh, save, ledger_check, image_size, recording_check

TOOL_DIR = Path(__file__).resolve().parent
def project_root(start=None):
    current = Path(start or Path.cwd()).resolve()
    for candidate in [current, *current.parents]:
        if (candidate/'Tools/Helix/reference.json').is_file():
            return candidate
    raise ValueError('No project adapter found; supply --project-root DIR')


def adapter_file(project, name):
    project = Path(project).resolve()
    return inside(project/'Tools/Helix'/name, project)


def verifiers(project):
    config = read(adapter_file(project, 'workflow-adapter.json'))
    items = config.get('verifiers', {})
    if set(items) != {'storage', 'comparison'}:
        raise ValueError('Configure storage and comparison verifiers in workflow-adapter.json')
    for name, file in items.items():
        if not isinstance(file, str) or Path(file).is_absolute():
            raise ValueError('Verifier paths must be project-relative')
        inside(Path(project)/file, project)
    return items













def owner_root(project):
    project = Path(project).resolve()
    marker = project / '.aikit/lane.json'
    return Path(read(marker)['owner']).resolve() if marker.exists() else project


def evidence_fetch(project, identifiers, output):
    owner = owner_root(project)
    if len(set(identifiers)) != len(identifiers):
        raise ValueError('Attachment IDs must be unique')
    staged = []
    for identifier in identifiers:
        match = re.fullmatch(r'(AK-\d+)#(a\d+)', identifier)
        if not match:
            raise ValueError('Use exact attachment IDs, for example AK-148#a5')
        issue = inside(owner / '.aikit/assistant/issues' / match[1], owner)
        metadata = read(issue / 'issue.json')
        records = [a for a in metadata['attachments'] if a['id'] == identifier]
        if len(records) != 1:
            raise ValueError(f'Attachment missing or ambiguous: {identifier}')
        record = records[0]
        source = inside(issue / 'attachments' / record['file'], issue / 'attachments')
        if digest(source) != record['sha256']:
            raise ValueError(f'Source hash mismatch: {identifier}')
        staged.append((identifier, source, record))
    out = fresh(inside(output, Path(project) / '.aikit/scratch'))
    files = []
    for identifier, source, record in staged:
        target = out / (identifier.replace('#', '-') + '-' + source.name)
        with target.open('xb') as stream:
            stream.write(source.read_bytes())
        if digest(target) != record['sha256']:
            raise ValueError(f'Consumer readback mismatch: {identifier}')
        files.append({'id': identifier, 'path': str(target), 'sha256': digest(target),
                      'bytes': target.stat().st_size, 'metadata': record})
    result = {'schemaVersion': 1, 'ownerProject': str(owner), 'files': files,
              'scope': 'Verified byte copies; archives are not extracted and visual acceptance is not inferred.'}
    save(out / 'fetch-receipt.json', result)
    return result








def capture_plan(project, width, height, kind):
    if width <= 0 or height <= 0:
        raise ValueError('Dimensions must be positive')
    profile = read(adapter_file(project, 'capture-capabilities.json'))
    checks = []
    for file, expected in profile['sourceHashes'].items():
        path = inside(Path(project) / file, project)
        checks.append({'path': str(path), 'matchesVerifiedSource': path.is_file() and digest(path) == expected})
    verified = bool(checks) and all(c['matchesVerifiedSource'] for c in checks)
    return {'requested': {'width': width, 'height': height, 'kind': kind}, 'sourceChecks': checks,
            'unityMotion': {'capabilitiesVerified': verified, 'nativeSupported': verified and max(width,height) <= profile['maxSide'],
                            'maxSide': profile['maxSide'], 'defaultMaxSide': profile['defaultMaxSide'], 'format': 'jpeg',
                            'maxSeconds': profile['maxSeconds'], 'fixedFps': 0},
            'browserMotion': {'evenDimensions': width % 2 == 0 and height % 2 == 0,
                              'note': 'Check actual encoded dimensions and nativeVideo after the pilot.'},
            'still': {'format': 'png', 'note': 'The motion recorder size limit does not apply to native still capture; confirm live viewport and PNG dimensions.'},
            'scope': 'Read-only capability plan; confirm live viewport and inspect a real pilot before expanding cases. A different viewport is a new case, never an implicit substitution.'}


def inspect_pilot(project, pilot, fingerprint):
    if pilot is None:
        return 'missing'
    path = inside(project/pilot['path'], project)
    if not path.is_file() or digest(path) != pilot['sha256']:
        return 'receipt unavailable or changed'
    record = read(path)
    if record['recipeFingerprint'] != fingerprint:
        return 'recipe changed'
    for side in ('helix', 'unity'):
        locator = record[side]
        if not isinstance(locator['observed'], str) or not locator['observed'].strip():
            raise ValueError('Pilot requires observed input/event and measurement for ' + side)
        artifact = inside(project/locator['path'], project)
        if not artifact.is_file() or digest(artifact) != locator['sha256']:
            return side + ' evidence unavailable or changed'
    return 'recorded'


def recipe_plan(project, case_id, viewport, output):
    project = Path(project).resolve()
    config = read(project/'Tools/Helix/reference.json')
    local = project/'Tools/Helix/reference.local.json'
    if local.exists():
        override = read(local)
        config = {**config, **override, 'helix': {**config['helix'], **override.get('helix', {})}}
    size = config['viewports'][viewport]
    out = inside(output, project/'.aikit/scratch')
    catalog_path = adapter_file(project, 'fixture-catalog.json')
    catalog = read(catalog_path).get(case_id, {}) if catalog_path.is_file() else {}
    scenario = config.get('scenarios', {}).get(case_id)
    if re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', case_id):
        fixture = adapter_file(project, 'fixtures/' + case_id + '.json')
        if fixture.is_file():
            if scenario is not None:
                raise ValueError('Duplicate scenario: ' + case_id)
            scenario = read(fixture)
            if scenario['id'] != case_id or scenario['schemaVersion'] != 1:
                raise ValueError('Invalid registered fixture: ' + case_id)
    gaps = []
    if scenario is None:
        gaps.append('Missing Helix scenario or registered fixture')
    elif 'viewport' in scenario and scenario['viewport'] != viewport:
        gaps.append('Fixture declares viewport ' + scenario['viewport'])
    if catalog.get('support') == 'unsupported':
        gaps.append(catalog['limitations'])
    if 'viewports' in catalog and viewport not in catalog['viewports']:
        gaps.append('Viewport outside catalog support')
    steps = scenario['steps'] if scenario is not None else []
    values = {'out': str(out/'unity'), 'scenario': case_id, 'width': size['width'], 'height': size['height'],
              'capture': str(out/'unity/unity.png'), 'receipt': str(out/'unity/unity.json')}
    def render(arg):
        def replace(match):
            value = values[match[1]]
            return str(value) if isinstance(value,int) else json.dumps(value)[1:-1]
        return re.sub(r'\{\{(\w+)\}\}', replace, arg)
    unity = scenario.get('unity', {}) if scenario is not None else {}
    stages = {key: [[render(arg) for arg in argv] for argv in (commands if isinstance(commands[0],list) else [commands])]
              for key, commands in unity.items()}
    procedure = catalog.get('procedure')
    if not procedure and not {'preflight', 'prepare', 'capture', 'restore'}.issubset(stages):
        gaps.append('Missing complete Unity stages or documented procedure')
    capture_steps = scenario.get('captureSteps', []) if scenario is not None else []
    files = list(catalog.get('files', [])) + [step['file'] for step in steps + capture_steps if 'file' in step]
    hashes = {}
    for name in dict.fromkeys(files):
        path = inside(project/name, project)
        if path.is_file():
            hashes[name] = digest(path)
        else:
            gaps.append('Missing recipe input: ' + name)
    contract = {field: catalog.get(field) for field in ('trigger', 'observation', 'measurement')}
    for field, value in contract.items():
        if not isinstance(value, str) or not value.strip():
            gaps.append('Declare ' + field + ' in fixture catalog')
    # Exclude pilot locators so publishing a receipt does not invalidate its recipe.
    identity = [case_id, viewport, size, config['helix'], scenario, hashes,
                {k:v for k,v in catalog.items() if k != 'pilots'}]
    fingerprint = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    pilot = catalog.get('pilots', {}).get(viewport)
    pilot_status = inspect_pilot(project, pilot, fingerprint)
    dispatch = dict(status='blocked' if gaps else ('pilot-recorded' if pilot_status == 'recorded' else 'pilot-required'),
                    gaps=gaps, recipeFingerprint=fingerprint, required=contract, pilot=pilot, pilotStatus=pilot_status,
                    owner=catalog.get('owner', catalog.get('unityRequirementOwner')))
    commands = [[str(project/'Tools/Helix/bin/helix'),'start','--project-root',str(project),'--viewport',viewport],
                [str(project/'Tools/Helix/bin/helix'),'scenario',case_id,'--project-root',str(project)]]
    setup_kind = 'fixture' if any(s.get('purpose') == 'fixture' for s in steps) else 'input'
    return {'case':case_id, 'viewport':size, 'reference':config['helix'], 'setupKind':setup_kind if scenario is not None else None,
            'sourceCommands':commands if scenario is not None else [], 'dispatch':dispatch,
            'unityExecutable':'ai-kit', 'unityStages':stages, 'fixture':catalog, 'fileHashes':hashes,
            'environment':{'AIKIT_QA_VIEWPORT':str(size['width'])+'x'+str(size['height']), 'AIKIT_QA_DIR':str(out/'unity')},
            'scope':'Plan only. Execute documented guards and cleanup; incomplete Unity stages require the linked fixture procedure, not invented commands.'}


def command_json(argv, cwd):
    result = subprocess.run(argv, cwd=cwd, text=True, capture_output=True, timeout=60)
    if result.returncode:
        raise ValueError(result.stderr or result.stdout)
    return json.loads(result.stdout)


def test_plan(project, editor, test_filter, output, assignment=None):
    project, editor = Path(project).resolve(), Path(editor).resolve()
    marker = read(project / '.aikit/lane.json')
    if marker.get('editor') is False:
        raise ValueError('Lane is editorless')
    if not editor.is_file():
        raise ValueError('Supply the installed Unity Editor executable explicitly')
    out = inside(output, project / '.aikit/scratch')
    profile = read(adapter_file(project, 'test-routing.json'))
    if not profile.get('sourceHashes'): raise ValueError('Empty test routing profile is unverified')
    candidates = list((project / 'Library/PackageCache').glob('com.unity.test-framework.performance@*'))
    verified = []
    for candidate in candidates:
        if all((candidate/file).is_file() and digest(candidate/file) == expected for file,expected in profile['sourceHashes'].items()):
            verified.append(str(candidate))
    if len(candidates) != 1 or len(verified) != 1:
        raise ValueError('Installed performance callback routing is unverified; inspect the package before updating test-routing.json')
    argv = [str(editor), '-projectPath', str(project), '-batchmode', '-runTests', '-testPlatform', 'EditMode',
            '-testFilter', test_filter, '-testResults', str(out/'test-results.xml'),
            '-perfTestResults', str(out/'performance-results.json'), '-logFile', str(out/'editor.log')]
    return {'project': str(project), 'owner': marker['owner'], 'assignment': assignment, 'argv': argv,
            'output': str(out), 'routing': verified[0], 'routingHashes': profile['sourceHashes'],
            'scope': 'Isolates runner outputs only. Tests must separately have verified save/preference isolation. Ordinary tests may not emit performance JSON.'}


def verify_assignment(plan, aikit):
    if not plan['assignment']:
        raise ValueError('An active managed assignment is required')
    assignment = command_json([aikit, 'team', 'report', plan['assignment']], plan['owner'])
    roster = command_json([aikit, 'team', 'roster'], plan['owner'])
    marker = read(Path(plan['project'])/'.aikit/lane.json')
    if assignment.get('state') != 'running' or not assignment.get('touchesEditor'):
        raise ValueError('Assignment is not running with Editor ownership')
    if not any(l['lane'] == marker['id'] and l.get('item') == assignment['item'] and l['state'] == 'ready' for l in roster['lanes']):
        raise ValueError('Assignment is not bound to this managed lane')


def test_preflight(project, assignment, output, aikit):
    project = Path(project).resolve()
    plan = {'project': str(project), 'owner': str(owner_root(project)), 'assignment': assignment}
    verify_assignment(plan, aikit)
    receipts = {}
    for key, script in verifiers(project).items():
        response = command_json([aikit, 'unity', 'eval', '@' + script], project)
        data = response.get('data', {})
        result = data.get('result', {})
        if response.get('success') is not True or result.get('success') is not True or not str(result.get('result','')).startswith('PASS:') or Path(data.get('target',{}).get('projectPath','')).resolve() != project:
            raise ValueError('Isolation verification did not pass on this lane: ' + script)
        receipts[key] = {'path': script, 'response': response, 'scriptSha256': digest(inside(project/script, project))}
    out = fresh(inside(output, project/'.aikit/scratch'))
    result = {**plan, 'at': time.time(), 'revision': subprocess.check_output(['git','rev-parse','HEAD'],cwd=project,text=True).strip(), 'checks': receipts}
    save(out/'isolation.json', result)
    return result


def test_run(plan, aikit, unity, timeout, isolation_receipt):
    verify_assignment(plan, aikit)
    lock = Path(plan['project'])/'.aikit/tmp/workflow-tests.lock'
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise ValueError('A project test runner lock exists; inspect its owner before another run')
    try:
        os.write(descriptor, json.dumps({'pid':os.getpid(),'assignment':plan['assignment']}).encode())
        os.close(descriptor)
        return _test_run_locked(plan, aikit, unity, timeout, isolation_receipt)
    finally:
        lock.unlink()


def _test_run_locked(plan, aikit, unity, timeout, isolation_receipt):
    verify_assignment(plan, aikit)
    receipt = read(isolation_receipt)
    revision = subprocess.check_output(['git','rev-parse','HEAD'],cwd=plan['project'],text=True).strip()
    if receipt.get('project') != plan['project'] or receipt.get('assignment') != plan['assignment'] or receipt.get('revision') != revision or not 0 <= time.time()-receipt.get('at',0) <= 1200:
        raise ValueError('Fresh isolation receipt must match this lane, assignment and revision (20 minute limit)')
    for name, script in verifiers(plan['project']).items():
        check = receipt.get('checks',{}).get(name,{})
        if check.get('path') != script or check.get('scriptSha256') != digest(inside(Path(plan['project'])/script, plan['project'])):
            raise ValueError('Isolation verifier changed since preflight')
    if pwd is None: raise ValueError('Managed Unity tests require Unix account-home support')
    account = pwd.getpwuid(os.getuid()).pw_dir
    if os.environ.get('HOME') != account or os.environ.get('CFFIXED_USER_HOME',account) != account:
        raise ValueError('Use the existing OS account HOME and CFFIXED_USER_HOME for Unity credentials; do not copy credentials')
    # The lock is a conservative independent guard if CLI process visibility is restricted.
    if (Path(plan['project'])/'Temp/UnityLockfile').exists():
        raise ValueError('Editor lock exists. Safely stop/disarm and close only the owned Editor first.')
    status = subprocess.run([unity,'status','--project-path',plan['project'],'--format','json'],text=True,capture_output=True,timeout=60)
    response = json.loads(status.stdout)
    if response.get('warnings') or response.get('data',{}).get('instances') or status.returncode != 12:
        raise ValueError('Cannot prove owned Editor is closed; inspect Unity status before running tests')
    codes = {e.get('code') for e in response.get('errors',[])}
    if codes != {'STATUS_NO_INSTANCES'}:
        raise ValueError('Unexpected Unity status result')
    out = fresh(plan['output'])
    save(out/'plan.json', plan)
    save(out/'isolation.json', receipt)
    result = {'completed': False, 'restoration': 'not attempted'}
    try:
        with (out/'process.log').open('w') as log:
            process = subprocess.Popen(plan['argv'], stdout=log, stderr=subprocess.STDOUT)
            try:
                result['exitCode'] = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait()
                raise ValueError('Test process exceeded deadline; only the owned process was terminated')
            except BaseException:
                process.terminate()
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait()
                raise
        xml = out/'test-results.xml'
        if not xml.is_file():
            raise ValueError('No real test XML was produced')
        tree = ET.parse(xml).getroot()
        cases = list(tree.iter('test-case'))
        result.update({'completed': True, 'xmlSha256': digest(xml), 'counts': tree.attrib,
                       'tests': [{'name':c.get('fullname',c.get('name')), 'result':c.get('result')} for c in cases],
                       'passed': result['exitCode'] == 0 and bool(cases) and all(c.get('result') == 'Passed' for c in cases)})
    except Exception as error:
        result['error'] = str(error)
        raise
    finally:
        # Supported lifecycle, never a shared daemon restart or fabricated lease.
        try:
            restored = subprocess.run([aikit,'unity','ensure'],cwd=plan['project'],text=True,capture_output=True,timeout=300)
            result['restoration'] = {'exit':restored.returncode,'stdout':restored.stdout,'stderr':restored.stderr}
        except subprocess.SubprocessError as error:
            result['restoration'] = {'exit': -1, 'error': str(error)}
        save(out/'run-receipt.json',result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('evidence-fetch');p.add_argument('attachments',nargs='+');p.add_argument('--project-root',type=Path,default=None);p.add_argument('--out',type=Path,required=True)
    p=sub.add_parser('ledger-check');p.add_argument('ledger',type=Path);p.add_argument('--inputs',type=Path,required=True)
    p=sub.add_parser('recording-check');p.add_argument('record',type=Path);p.add_argument('--width',type=int,required=True);p.add_argument('--height',type=int,required=True);p.add_argument('--first-frame',type=int);p.add_argument('--last-frame',type=int)
    p.add_argument('--event', help='Unique action in the events receipt')
    p.add_argument('--events', type=Path, help='Same-run events JSON; defaults to --trace when supplied')
    p.add_argument('--before-ms', type=int)
    p.add_argument('--after-ms', type=int)
    p.add_argument('--trace', type=Path, help='Same-recording player-loop trace')
    p.add_argument('--visual-samples', type=Path, help='Indexed observed frames and measurement method')
    p.add_argument('--baseline-trace', type=Path, help='Separate trace-only replay of the same named event')
    p=sub.add_parser('capture-plan');p.add_argument('--project-root',type=Path,default=None);p.add_argument('--width',type=int,required=True);p.add_argument('--height',type=int,required=True);p.add_argument('--kind',choices=['still','motion'],default='motion')
    p=sub.add_parser('recipe-plan');p.add_argument('case');p.add_argument('--viewport',required=True);p.add_argument('--project-root',type=Path,default=None);p.add_argument('--out',type=Path,required=True)
    p=sub.add_parser('test-preflight');p.add_argument('--project-root',type=Path,required=True);p.add_argument('--assignment',required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--aikit',default='ai-kit')
    for name in ['test-plan','test-run']:
        p=sub.add_parser(name);p.add_argument('--project-root',type=Path,required=True);p.add_argument('--editor',type=Path,required=True);p.add_argument('--filter',required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--assignment');p.add_argument('--execute',action='store_true');p.add_argument('--aikit',default='ai-kit');p.add_argument('--unity',default='unity');p.add_argument('--timeout',type=int,default=600);p.add_argument('--isolation-receipt',type=Path)
    args=parser.parse_args()
    if hasattr(args, 'project_root'):
        args.project_root = args.project_root.resolve() if args.project_root else project_root()
        if hasattr(args, 'out') and not args.out.is_absolute(): args.out = args.project_root / args.out
    if args.command=='evidence-fetch':result=evidence_fetch(args.project_root,args.attachments,args.out)
    elif args.command=='ledger-check':result=ledger_check(args.ledger,args.inputs)
    elif args.command=='recording-check':
        window = None
        if any(x is not None for x in (args.event, args.events, args.before_ms, args.after_ms, args.trace, args.visual_samples, args.baseline_trace)):
            events = args.events or args.trace
            if not args.event or not events or args.before_ms is None or args.after_ms is None:
                parser.error('Timing requires --event, --events or --trace, --before-ms and --after-ms')
            window = dict(events_path=events, name=args.event, before_ms=args.before_ms, after_ms=args.after_ms,
                          trace_path=args.trace, visual_path=args.visual_samples, baseline_path=args.baseline_trace)
        result = recording_check(args.record, args.width, args.height, args.first_frame, args.last_frame, window=window)
    elif args.command=='capture-plan':result=capture_plan(args.project_root,args.width,args.height,args.kind)
    elif args.command=='recipe-plan':result=recipe_plan(args.project_root,args.case,args.viewport,args.out)
    elif args.command=='test-preflight':result=test_preflight(args.project_root,args.assignment,args.out,args.aikit)
    else:
        result=test_plan(args.project_root,args.editor,args.filter,args.out,args.assignment)
        if args.command=='test-run':
            if not args.execute:raise ValueError('test-run requires --execute; use test-plan to inspect first')
            if not args.isolation_receipt:raise ValueError('test-run requires --isolation-receipt from test-preflight')
            result=test_run(result,args.aikit,args.unity,args.timeout,args.isolation_receipt)
    print(json.dumps(result,indent=2))
    if args.command=='test-run' and (not result.get('passed') or result.get('restoration',{}).get('exit') != 0):return 1
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError,KeyError,OSError,ET.ParseError,subprocess.SubprocessError) as error:
        print(json.dumps({'ok':False,'error':str(error)}),file=sys.stderr)
        sys.exit(1)
