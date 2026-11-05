#!/usr/bin/env python3
"""Adapter-driven readiness and synchronized motion for any configured conversion project."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

from evidence_utils import digest, inside, recording_check
from workflow import capture_plan, owner_root, verify_assignment

GATE_HOOKS = {'preflight', 'probe', 'prepare', 'restore'}
MOTION_HOOKS = GATE_HOOKS | {'recordStart', 'recordStatus', 'action', 'recordStop', 'events'}


def load_adapter(project, motion):
    path = project/'Tools/Helix/workflow-adapter.json'
    config = json.loads(path.read_text()).get('capture')
    if not isinstance(config, dict) or config.get('schemaVersion') != 1:
        raise ValueError('Supply capture schemaVersion 1 in the project workflow-adapter.json')
    if type(config.get('managedAiKit')) is not bool:
        raise ValueError('Explicit capture.managedAiKit true/false is required')
    hooks = config.get('hooks', {})
    for name in MOTION_HOOKS if motion else GATE_HOOKS:
        argv = hooks.get(name)
        if not isinstance(argv, list) or not argv or any(not isinstance(a, str) or not a for a in argv):
            raise ValueError('Missing executable argument array: capture.hooks.'+name)
    hashes = config.get('sourceHashes', {})
    if not isinstance(hashes, dict) or not hashes:
        raise ValueError('Capture requires nonempty reviewed sourceHashes for adapter scripts')
    for file, expected in hashes.items():
        if Path(file).is_absolute() or digest(inside(project/file, project)) != expected:
            raise ValueError('Adapter source changed: '+file)
    return config, digest(path)


def validate_expected(expected):
    if not isinstance(expected.get('identity'), dict) or not expected['identity']:
        raise ValueError('Expected identity must contain project-defined fixture/state fingerprints')
    for key in ('width','height'):
        if type(expected.get(key)) is not int or expected[key] <= 0:
            raise ValueError('Expected native width/height must be positive integers')


def ready(probe, expected):
    state = probe.get('state')
    if state not in ('waiting', 'prepare', 'ready'):
        raise ValueError('Probe state must be waiting, prepare or ready')
    if state != 'ready': return False
    if probe.get('identity') != expected['identity']:
        raise ValueError('Ready state has a different fixture identity')
    if probe.get('width') != expected['width'] or probe.get('height') != expected['height']:
        raise ValueError('Ready state has a different native viewport')
    if probe.get('quiescent') is not True or type(probe.get('frame')) is not int:
        raise ValueError('Ready state must be quiescent with an observed frame')
    return True


def endpoints(events, action_frame):
    first, last = events.get('firstFrame'), events.get('lastFrame')
    if events.get('complete') is not True or type(first) is not int or type(last) is not int or not action_frame <= first <= last:
        raise ValueError('Missing, incomplete, stale or reversed observed event endpoints')
    return first, last


class Capture:
    def __init__(self, project, expected_path, output, assignment, timeout, seconds, aikit, motion):
        self.project = project.resolve()
        self.expected_path = expected_path.resolve()
        self.expected = json.loads(self.expected_path.read_text()); validate_expected(self.expected)
        self.config, config_hash = load_adapter(self.project, motion)
        scratch = inside(self.project/'.aikit/scratch', self.project)
        self.output = inside(output, scratch)
        if not 1 <= timeout <= 300 or not 0.5 <= seconds <= 10:
            raise ValueError('timeout must be 1..300 seconds; recording seconds 0.5..10')
        if self.config['managedAiKit']:
            verify_assignment({'project':str(self.project),'owner':str(owner_root(self.project)), 'assignment':assignment}, aikit)
        if motion:
            profile = capture_plan(self.project,self.expected['width'],self.expected['height'],'motion')
            if not profile['unityMotion']['nativeSupported'] or seconds > profile['unityMotion']['maxSeconds']:
                raise ValueError('Native recording capability profile unverified or unsupported')
        self.output.mkdir(parents=True, exist_ok=False)
        # Allocate id before mutation so lost start replies can still be stopped by their owner.
        self.recording = 'rec-'+datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:4]
        self.values = {'projectRoot':str(self.project),'out':str(self.output),'expected':str(self.expected_path),
                       'recordingId':self.recording,'seconds':str(seconds),'width':str(self.expected['width']),
                       'height':str(self.expected['height']),'assignment':assignment or ''}
        self.deadline = time.monotonic()+timeout
        self.receipt = {'passed':False,'project':str(self.project),'assignment':assignment,
                        'adapterSha256':config_hash,'sourceHashes':self.config['sourceHashes'],
                        'expected':self.expected,'expectedSha256':digest(self.expected_path),
                        'recordingId':self.recording,'startedAt':time.time(),'hooks':[]}
        try:
            self.receipt['revision'] = subprocess.check_output(['git','rev-parse','HEAD'], cwd=self.project, text=True, stderr=subprocess.DEVNULL, timeout=10).strip()
        except (OSError, subprocess.SubprocessError):
            self.receipt['revision'] = None
        self.receipt['revisionScope'] = 'HEAD only; no clean-tree or parity claim. Adapter identity must include relevant dirty/source inputs.'
        self.preflight_attempted = False
        self.record_attempted = False

    def hook(self, name, cleanup=False):
        # Reject mid-session adapter drift before any new action. Cleanup still uses saved argv.
        if not cleanup:
            config, current = load_adapter(self.project, name not in GATE_HOOKS)
            if current != self.receipt['adapterSha256'] or digest(self.expected_path) != self.receipt['expectedSha256']:
                raise ValueError('Adapter or expected identity changed during capture')
        argv=[]
        for arg in self.config['hooks'][name]:
            def substitute(match):
                key=match.group(1)
                if key not in self.values: raise ValueError('Unknown hook placeholder: '+key)
                return self.values[key]
            argv.append(re.sub(r'\{\{(\w+)\}\}',substitute,arg))
        remaining = 30 if cleanup else self.deadline-time.monotonic()
        if remaining <= 0: raise TimeoutError('Capture deadline expired')
        entry={'hook':name,'startedAt':time.time()};self.receipt['hooks'].append(entry)
        try:
            result=subprocess.run(argv,cwd=self.project,text=True,capture_output=True,timeout=min(30,remaining))
            if result.returncode: raise ValueError(result.stderr or result.stdout)
            value=json.loads(result.stdout)
            if not isinstance(value,dict) or value.get('ok') is not True or Path(value.get('projectRoot','')).resolve()!=self.project:
                raise ValueError('Hook failed or reported another project: '+name)
            entry['result']=value
            return value
        except Exception as error:
            entry['error']=str(error);raise
        finally:entry['finishedAt']=time.time()

    def gate(self):
        self.preflight_attempted=True
        checked=self.hook('preflight')
        if checked.get('isolated') is not True or checked.get('compatible') is not True:
            raise ValueError('Project preflight did not verify isolation and compatibility')
        prepared=False
        while time.monotonic()<self.deadline:
            probe=self.hook('probe')
            if ready(probe,self.expected):return probe
            if probe['state']=='prepare' and not prepared:
                prepared=True  # At most once, including lost reply.
                self.hook('prepare')
            time.sleep(min(0.25,max(0,self.deadline-time.monotonic())))
        raise TimeoutError('Readiness timed out without replaying preparation')

    def status(self):
        status=self.hook('recordStatus')
        if status.get('id')!=self.recording or status.get('state') not in ('armed','recording','done','failed','interrupted','timedOut'):
            raise ValueError('Recorder status has wrong id/state')
        return status

    def motion(self):
        self.record_attempted=True
        started=self.hook('recordStart')
        if started.get('id')!=self.recording:raise ValueError('Recorder started with a different owner id')
        while True:
            status=self.status()
            if status['state']=='recording' and type(status.get('frames')) is int and status['frames']>0:break
            if status['state'] not in ('armed','recording'):raise ValueError('Recording ended before actions')
            time.sleep(0.1)
        # Adapter action must check recorder id/activity and a captured frame atomically with invocation.
        action=self.hook('action')
        if action.get('id')!=self.recording or action.get('recordingConfirmed') is not True or type(action.get('firstFrame')) is not int:
            raise ValueError('Action did not confirm atomic recorder guard and first frame')
        while True:
            status=self.status()
            if status['state'] not in ('armed','recording'):break
            time.sleep(0.25)
        if status['state']!='done':raise ValueError('Recording failed: '+status['state'])
        events=self.hook('events')
        first,last=endpoints(events,action['firstFrame'])
        record=inside(self.output/status['recordPath'],self.output)
        self.receipt['coverage']=recording_check(record,self.expected['width'],self.expected['height'],first,last)

    def run(self, motion=False):
        lock = inside(self.project/'.aikit/tmp/helix-capture.lock', self.project)
        lock.parent.mkdir(parents=True, exist_ok=True)
        lock_identity = None
        try:
            descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(descriptor, 'w') as stream:
                lock_identity = os.fstat(stream.fileno()).st_ino
                json.dump({'pid':os.getpid(),'output':str(self.output),'recordingId':self.recording}, stream)
            self.receipt['ready']=self.gate()
            if motion:self.motion()
            self.receipt['passed']=True
        except Exception as error:self.receipt['error']=str(error)
        finally:
            if self.record_attempted and not self.receipt['passed']:
                try:self.receipt['stop']=self.hook('recordStop',cleanup=True)
                except Exception as error:self.receipt['stopError']=str(error)
            if self.preflight_attempted and (motion or not self.receipt['passed']):
                try:
                    restored=self.hook('restore',cleanup=True)
                    self.receipt['restoration']=restored
                    if restored.get('restored') is not True:
                        raise ValueError('Project restoration was not verified')
                except Exception as error:
                    self.receipt['restorationError']=str(error);self.receipt['passed']=False
            if lock_identity is not None and lock.exists() and lock.stat().st_ino == lock_identity:
                lock.unlink()
            self.receipt['finishedAt']=time.time()
            (self.output/'capture.json').write_text(json.dumps(self.receipt,indent=2)+'\n')
        return self.receipt


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode',choices=['gate','motion']);parser.add_argument('--project-root',type=Path,required=True)
    parser.add_argument('--expected',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--assignment');parser.add_argument('--aikit',default='ai-kit')
    parser.add_argument('--timeout',type=float,default=90);parser.add_argument('--seconds',type=float,default=8)
    parser.add_argument('--execute',action='store_true')
    args=parser.parse_args()
    try:
        if not args.execute:raise ValueError('Execution requires --execute and reviewed project-owned hooks')
        project=args.project_root.resolve()
        expected=args.expected if args.expected.is_absolute() else project/args.expected
        output=args.out if args.out.is_absolute() else project/args.out
        result=Capture(project,expected,output,args.assignment,args.timeout,args.seconds,args.aikit,args.mode=='motion').run(args.mode=='motion')
        print(json.dumps(result,indent=2));return 0 if result['passed'] else 1
    except (ValueError,KeyError,OSError,subprocess.SubprocessError) as error:
        print(json.dumps({'passed':False,'error':str(error)}),file=sys.stderr);return 1


if __name__=='__main__':sys.exit(main())
