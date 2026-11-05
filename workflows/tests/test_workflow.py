import sys
import importlib.util
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).parents[1]))

spec = importlib.util.spec_from_file_location('workflow', Path(__file__).parents[1]/'workflow.py')
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_attachment_copy_hash_readback_and_no_overwrite(self):
        issue = self.root/'.aikit/assistant/issues/AK-1'
        (issue/'attachments').mkdir(parents=True)
        source = issue/'attachments/proof.bin'
        source.write_bytes(b'original evidence')
        w.save(issue/'issue.json', {'attachments':[{'id':'AK-1#a1','file':'proof.bin','sha256':w.digest(source)}]})
        out = self.root/'.aikit/scratch/fetched'
        result = w.evidence_fetch(self.root,['AK-1#a1'],out)
        self.assertEqual(Path(result['files'][0]['path']).read_bytes(),source.read_bytes())
        with self.assertRaises(ValueError):w.evidence_fetch(self.root,['AK-1#a1'],out)
        source.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'hash mismatch'):w.evidence_fetch(self.root,['AK-1#a1'],self.root/'.aikit/scratch/new')

    def test_attachment_rejects_escape_and_symlink(self):
        issue = self.root/'.aikit/assistant/issues/AK-1';(issue/'attachments').mkdir(parents=True)
        outside = self.root/'secret';outside.write_bytes(b'x')
        (issue/'attachments/link').symlink_to(outside)
        for filename in ['../../../../secret','link']:
            w.save(issue/'issue.json',{'attachments':[{'id':'AK-1#a1','file':filename,'sha256':w.digest(outside)}]})
            with self.assertRaises(ValueError):w.evidence_fetch(self.root,['AK-1#a1'],self.root/'.aikit/scratch/out')

    def test_ledger_invalidates_only_changed_case_and_detects_lost_evidence(self):
        image=self.root/'image';image.write_bytes(b'evidence')
        cases=[{'id':n,'inputs':{'font':'a','viewport':'phone'},'status':'difference','evidence':[{'path':'image','sha256':w.digest(image)}]} for n in ['one','two']]
        w.save(self.root/'ledger.json',{'cases':cases});w.save(self.root/'inputs.json',{'one':{'font':'b','viewport':'phone'},'two':cases[1]['inputs']})
        results=w.ledger_check(self.root/'ledger.json',self.root/'inputs.json')['cases']
        self.assertFalse(results[0]['evidenceReusable']);self.assertTrue(results[1]['evidenceReusable'])
        self.assertEqual(results[1]['recordedVerdict'],'difference')
        image.unlink();self.assertFalse(w.ledger_check(self.root/'ledger.json',self.root/'inputs.json')['cases'][1]['evidenceReusable'])

    def test_recording_reads_actual_headers_and_endpoint(self):
        # Minimal SOF header sufficient to read JPEG encoded dimensions.
        jpeg=b'\xff\xd8\xff\xc0'+struct.pack('>H B H H B',8,8,1688,780,0)+b'\xff\xd9'
        (self.root/'frame.jpg').write_bytes(jpeg)
        record={'screen':{'width':780,'height':1688},'frameSize':{'width':780,'height':1688},'frames':[{'file':'frame.jpg','frame':42,'t':0}]}
        w.save(self.root/'record.json',record)
        result=w.recording_check(self.root/'record.json',780,1688,42,42)
        self.assertTrue(result['lossy']);self.assertEqual(result['formats'],['jpeg'])
        with self.assertRaisesRegex(ValueError,'endpoint'):w.recording_check(self.root/'record.json',780,1688,last_frame=43)
        record['screen']['height']=720;w.save(self.root/'record.json',record)
        with self.assertRaises(ValueError):w.recording_check(self.root/'record.json',780,1688)

    def test_capture_profiles_are_project_owned_and_empty_hashes_are_unverified(self):
        config=self.root/'Tools/Helix';config.mkdir(parents=True)
        w.save(config/'capture-capabilities.json',{'sourceHashes':{},'maxSide':2048,'defaultMaxSide':720,'maxSeconds':10})
        result=w.capture_plan(self.root,1170,2532,'motion')
        self.assertFalse(result['unityMotion']['nativeSupported'])
        self.assertFalse(result['unityMotion']['capabilitiesVerified'])
        self.assertEqual(result['requested']['height'],2532)

    def test_recipe_uses_only_selected_project(self):
        config=self.root/'Tools/Helix';config.mkdir(parents=True)
        (self.root/'fixture.js').write_text('({ok:true})')
        w.save(config/'reference.json',{'helix':{'project':'sample','variant':'Default'},'viewports':{'small':{'width':320,'height':640}},'scenarios':{'example':{'steps':[{'kind':'script','purpose':'fixture','file':'fixture.js'}]}}})
        w.save(config/'fixture-catalog.json',{'example':{'files':['fixture.js']}})
        result=w.recipe_plan(self.root,'example','small',self.root/'.aikit/scratch/recipe')
        self.assertEqual(result['unityStages'],{})
        self.assertIn('fixture.js',result['fileHashes'])

    def prepare_runner(self):
        project=self.root/'lane';(project/'.aikit').mkdir(parents=True)
        w.save(project/'.aikit/lane.json',{'id':'lane-1','owner':str(self.root)})
        for name in ['verify-storage.cs','verify-comparison.cs']:
            f=project/'Tools/Rendering'/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_text('verification')
        (project/'Tools/Helix').mkdir(parents=True)
        w.save(project/'Tools/Helix/workflow-adapter.json',{'verifiers':{'storage':'Tools/Rendering/verify-storage.cs','comparison':'Tools/Rendering/verify-comparison.cs'}})
        out=project/'.aikit/scratch/tests'
        plan={'project':str(project),'owner':str(self.root),'assignment':'A-1','output':str(out),'argv':['fake-editor']}
        receipt={'project':str(project),'assignment':'A-1','revision':'abc','at':time.time(),'checks':{key:{'path':path,'scriptSha256':w.digest(project/path)} for key,path in w.verifiers(project).items()}}
        w.save(self.root/'isolation.json',receipt)
        return plan,receipt

    def test_missing_or_changed_verifiers_refuse_execution(self):
        plan,receipt=self.prepare_runner()
        (Path(plan['project'])/'Tools/Rendering/verify-storage.cs').write_text('changed')
        with patch.object(w,'verify_assignment'),patch.object(w.subprocess,'check_output',return_value='abc'),patch.object(w.subprocess,'Popen') as launch:
            with self.assertRaisesRegex(ValueError,'verifier changed'):w.test_run(plan,'aikit','unity',60,self.root/'isolation.json')
            launch.assert_not_called()
        (Path(plan['project'])/'Tools/Helix/workflow-adapter.json').unlink()
        with self.assertRaises(FileNotFoundError):w.verifiers(plan['project'])

    def test_assignment_rejects_wrong_lane_and_idle_seat(self):
        plan,_=self.prepare_runner()
        for assignment,lanes in [({'state':'completed','touchesEditor':True,'item':'AK-1'},[]),({'state':'running','touchesEditor':True,'item':'AK-1'},[{'lane':'lane-1','state':'ready','item':'AK-2'}])]:
            with patch.object(w,'command_json',side_effect=[assignment,{'lanes':lanes}]):
                with self.assertRaises(ValueError):w.verify_assignment(plan,'aikit')

    def test_runner_refuses_stale_receipt_before_launch(self):
        plan,receipt=self.prepare_runner();receipt['at']=0;w.save(self.root/'isolation.json',receipt)
        with patch.object(w,'verify_assignment'),patch.object(w.subprocess,'check_output',return_value='abc'),patch.object(w.subprocess,'Popen') as launch:
            with self.assertRaisesRegex(ValueError,'Fresh isolation'):w.test_run(plan,'aikit','unity',60,self.root/'isolation.json')
            launch.assert_not_called()

    def test_runner_xml_and_restore_even_if_xml_missing(self):
        for provide_xml in [True,False]:
            plan,_=self.prepare_runner() if not (self.root/'lane').exists() else (None,None)
            if plan is None:
                import shutil
                shutil.rmtree(self.root/'lane');plan,_=self.prepare_runner()
            def started(*args,**kwargs):
                if provide_xml:Path(plan['output'],'test-results.xml').write_text('<test-run total="1" passed="1"><test-case fullname="Fixture.Test" result="Passed"/></test-run>')
                process=Mock();process.wait.return_value=0;return process
            status=subprocess.CompletedProcess([],12,json.dumps({'data':{'instances':[]},'errors':[{'code':'STATUS_NO_INSTANCES'}],'warnings':[]}), '')
            restored=subprocess.CompletedProcess([],0,'ready','')
            account=w.pwd.getpwuid(os.getuid()).pw_dir
            with patch.object(w,'verify_assignment'),patch.object(w.subprocess,'check_output',return_value='abc'),patch.dict(os.environ,{'HOME':account,'CFFIXED_USER_HOME':account}),patch.object(w.subprocess,'run',side_effect=[status,restored]),patch.object(w.subprocess,'Popen',side_effect=started):
                if provide_xml:self.assertTrue(w.test_run(plan,'aikit','unity',60,self.root/'isolation.json')['passed'])
                else:
                    with self.assertRaisesRegex(ValueError,'No real test XML'):w.test_run(plan,'aikit','unity',60,self.root/'isolation.json')
            self.assertEqual(w.read(Path(plan['output'])/'run-receipt.json')['restoration']['exit'],0)

    def test_timeout_terminates_owned_process_and_restores(self):
        plan,_=self.prepare_runner()
        process=Mock();process.wait.side_effect=[subprocess.TimeoutExpired('owned-editor',1),0]
        status=subprocess.CompletedProcess([],12,json.dumps({'data':{'instances':[]},'errors':[{'code':'STATUS_NO_INSTANCES'}],'warnings':[]}), '')
        restored=subprocess.CompletedProcess([],0,'ready','')
        account=w.pwd.getpwuid(os.getuid()).pw_dir
        with patch.object(w,'verify_assignment'),patch.object(w.subprocess,'check_output',return_value='abc'),patch.dict(os.environ,{'HOME':account,'CFFIXED_USER_HOME':account}),patch.object(w.subprocess,'run',side_effect=[status,restored]),patch.object(w.subprocess,'Popen',return_value=process):
            with self.assertRaisesRegex(ValueError,'exceeded deadline'):w.test_run(plan,'aikit','unity',1,self.root/'isolation.json')
        process.terminate.assert_called_once();process.kill.assert_not_called()
        receipt=w.read(Path(plan['output'])/'run-receipt.json')
        self.assertEqual(receipt['restoration']['exit'],0)
        self.assertIn('exceeded deadline',receipt['error'])
        self.assertFalse((Path(plan['project'])/'.aikit/tmp/workflow-tests.lock').exists())

    def test_existing_test_lock_refuses_second_runner(self):
        plan,_=self.prepare_runner();lock=Path(plan['project'])/'.aikit/tmp/workflow-tests.lock'
        lock.parent.mkdir(parents=True);lock.write_text('existing owner')
        with patch.object(w,'verify_assignment'),patch.object(w.subprocess,'Popen') as launch:
            with self.assertRaisesRegex(ValueError,'lock exists'):w.test_run(plan,'aikit','unity',1,self.root/'isolation.json')
            launch.assert_not_called()
        self.assertEqual(lock.read_text(),'existing owner')


if __name__=='__main__':unittest.main()
