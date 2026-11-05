import base64
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from capture import Capture, endpoints

HOOK = '''import json,sys
from pathlib import Path
name,root,out,expected,identifier,mode=sys.argv[1:]
out=Path(out);expected=json.loads(Path(expected).read_text());result={'ok':True,'projectRoot':root}
with (out/'calls.txt').open('a') as log: log.write(name+'\\n')
if name=='preflight': result.update(isolated=True,compatible=True)
elif name=='prepare':
 (out/'prepared').write_text('yes')
 if mode=='lost':raise SystemExit('lost reply')
elif name=='probe':
 if not (out/'prepared').exists():result.update(state='prepare')
 else:result.update(state='ready',identity=expected['identity'] if mode!='wrong' else {'other':True},width=1,height=1,quiescent=True,frame=9)
elif name=='recordStart': result.update(id=identifier,state='recording')
elif name=='recordStatus':
 if mode=='early':result.update(id=identifier,state='done',frames=1)
 elif not (out/'acted').exists():result.update(id=identifier,state='recording',frames=1)
 else:
  import base64
  (out/'first.png').write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII='))
  (out/'last.png').write_bytes((out/'first.png').read_bytes())
  (out/'record.json').write_text(json.dumps({'screen':{'width':1,'height':1},'frameSize':{'width':1,'height':1},'frames':[{'file':'first.png','frame':10,'t':0},{'file':'last.png','frame':20,'t':1}]}))
  result.update(id=identifier,state='done',frames=2,recordPath='record.json')
elif name=='action':
 (out/'acted').write_text('yes');result.update(id=identifier,recordingConfirmed=True,firstFrame=10)
 if mode=='action-lost':raise SystemExit('lost action reply')
elif name=='events':result.update(complete=True,firstFrame=10,lastFrame=20)
elif name=='restore':result.update(restored=mode!='restore-fails')
print(json.dumps(result))
'''


class CaptureTests(unittest.TestCase):
    def fixture(self, root, identity, mode='normal'):
        config=root/'Tools/Helix';config.mkdir(parents=True)
        hook=root/'hooks.py';hook.write_text(HOOK)
        hashes={'hooks.py':hashlib.sha256(hook.read_bytes()).hexdigest()}
        hooks={name:[sys.executable,str(hook),name,'{{projectRoot}}','{{out}}','{{expected}}','{{recordingId}}',mode]
               for name in ['preflight','probe','prepare','restore','recordStart','recordStatus','recordStop','action','events']}
        (config/'workflow-adapter.json').write_text(json.dumps({'capture':{'schemaVersion':1,'managedAiKit':False,'sourceHashes':hashes,'hooks':hooks}}))
        (config/'capture-capabilities.json').write_text(json.dumps({'maxSide':100,'defaultMaxSide':100,'maxSeconds':10,'sourceHashes':hashes}))
        expected=root/'expected.json';expected.write_text(json.dumps({'identity':identity,'width':1,'height':1}))
        return expected

    def run_case(self, mode='normal',identity=None,motion=True):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        root=Path(temporary.name);expected=self.fixture(root,identity or {'fixture':'puzzle-grid','seed':7},mode)
        run=Capture(root,expected,root/'.aikit/scratch/run',None,20,3,'ai-kit',motion)
        return run.run(motion), (run.output/'calls.txt').read_text().splitlines()

    def test_two_unrelated_games_use_same_motion_protocol(self):
        for identity in [{'fixture':'puzzle-grid','rows':3,'seed':7},{'vehicle':'spaceship','trajectory':'orbit','sourceHash':'abc'}]:
            with self.subTest(identity=identity):
                result,calls=self.run_case(identity=identity)
                self.assertTrue(result['passed'],result.get('error'))
                self.assertEqual(result['coverage']['frames'],2)
                self.assertLess(calls.index('recordStatus'),calls.index('action'))
                self.assertEqual(calls[-1],'restore')

    def test_wrong_fixture_restores_without_starting_recording(self):
        result,calls=self.run_case('wrong')
        self.assertFalse(result['passed']);self.assertNotIn('recordStart',calls);self.assertEqual(calls[-1],'restore')

    def test_lost_prepare_reply_never_replayed(self):
        result,calls=self.run_case('lost')
        self.assertFalse(result['passed']);self.assertEqual(calls.count('prepare'),1);self.assertEqual(calls[-1],'restore')

    def test_early_recorder_does_not_run_action(self):
        result,calls=self.run_case('early')
        self.assertFalse(result['passed']);self.assertNotIn('action',calls);self.assertIn('recordStop',calls)

    def test_lost_action_reply_stops_owned_recording_without_replay(self):
        result,calls=self.run_case('action-lost')
        self.assertFalse(result['passed']);self.assertEqual(calls.count('action'),1);self.assertIn('recordStop',calls)

    def test_restore_failure_fails_whole_result(self):
        result,calls=self.run_case('restore-fails')
        self.assertFalse(result['passed']);self.assertIn('restorationError',result)

    def test_gate_success_leaves_session_ready_for_caller(self):
        result,calls=self.run_case(motion=False)
        self.assertTrue(result['passed']);self.assertNotIn('recordStart',calls);self.assertNotIn('restore',calls)

    def test_changed_source_fails_before_execution(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);expected=self.fixture(root,{'game':'two'})
            (root/'hooks.py').write_text('changed')
            with self.assertRaisesRegex(ValueError,'source changed'):
                Capture(root,expected,root/'.aikit/scratch/run',None,10,3,'ai-kit',True)

    def test_outputs_must_stay_in_project_scratch(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);expected=self.fixture(root,{'game':'two'})
            with self.assertRaises(ValueError):Capture(root,expected,root/'other',None,10,3,'ai-kit',False)

    def test_missing_adapter_does_not_invent_game_defaults(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);expected=self.fixture(root,{'game':'two'})
            (root/'Tools/Helix/workflow-adapter.json').write_text('{}')
            with self.assertRaises(ValueError):Capture(root,expected,root/'.aikit/scratch/run',None,10,3,'ai-kit',False)

    def test_existing_capture_lock_is_preserved_without_hooks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);expected=self.fixture(root,{'game':'two'})
            lock=root/'.aikit/tmp/helix-capture.lock';lock.parent.mkdir(parents=True);lock.write_text('existing owner')
            run=Capture(root,expected,root/'.aikit/scratch/run',None,10,3,'ai-kit',False)
            result=run.run(False)
            self.assertFalse(result['passed']);self.assertEqual(result['hooks'],[])
            self.assertEqual(lock.read_text(),'existing owner')

    def test_scratch_symlink_cannot_escape_project(self):
        with tempfile.TemporaryDirectory() as temporary, tempfile.TemporaryDirectory() as outside:
            root=Path(temporary);expected=self.fixture(root,{'game':'two'})
            (root/'.aikit').mkdir();(root/'.aikit/scratch').symlink_to(outside,target_is_directory=True)
            with self.assertRaises(ValueError):Capture(root,expected,root/'.aikit/scratch/run',None,10,3,'ai-kit',False)

    def test_endpoints_must_follow_guarded_action(self):
        with self.assertRaises(ValueError):endpoints({'complete':True,'firstFrame':1,'lastFrame':20},10)
        with self.assertRaises(ValueError):endpoints({'complete':False,'firstFrame':10,'lastFrame':20},10)


if __name__=='__main__':unittest.main()
