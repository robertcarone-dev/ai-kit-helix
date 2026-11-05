import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import delivery


class DeliveryTests(unittest.TestCase):
    def test_pack_reconstruct_and_detect_tampered_part(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); source=root/'source';source.mkdir();(source/'receipt.json').write_text('{"revision":"original"}')
            result=delivery.pack(source,root/'package','original',1)
            self.assertEqual(delivery.verify_package(root/'package'),result)
            self.assertEqual(result['payloads'][0]['sha256'],delivery.digest(source/'receipt.json'))
            (root/'package'/result['parts'][0]['path']).write_bytes(b'changed')
            with self.assertRaises(ValueError):delivery.verify_package(root/'package')

    def test_large_evidence_is_split_and_reconstruction_verified(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source';source.mkdir();(source/'frames.bin').write_bytes(os.urandom(2*1024*1024))
            result=delivery.pack(source,root/'package','original',1)
            self.assertGreater(len(result['parts']),1)
            self.assertTrue(all(part['bytes']<=1024*1024 for part in result['parts']))
            self.assertEqual(delivery.verify_package(root/'package'),result)

    def test_symlink_source_and_nested_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source';source.mkdir();(source/'file').write_text('data')
            (root/'link').symlink_to(source,target_is_directory=True)
            with self.assertRaises(ValueError):delivery.pack(root/'link',root/'out','r',1)
            (source/'link').symlink_to(source/'file')
            with self.assertRaises(ValueError):delivery.pack(source,root/'out','r',1)

    def test_output_inside_source_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):delivery.pack(Path(tmp),Path(tmp)/'out','r',1)

    def test_integration_detects_missing_then_equivalent_patch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            def git(*args):return subprocess.check_output(['git',*args],cwd=root,stderr=subprocess.DEVNULL,text=True).strip()
            git('init','-b','main');git('config','user.email','test@example.invalid');git('config','user.name','Test')
            (root/'base').write_text('base');git('add','.');git('commit','-m','base');git('checkout','-b','work')
            (root/'change').write_text('change');git('add','.');git('commit','-m','change');commit=git('rev-parse','HEAD')
            self.assertFalse(delivery.integration(root,'work','main')['integrated'])
            git('checkout','main');(root/'other').write_text('other');git('add','.');git('commit','-m','other');git('cherry-pick',commit)
            report=delivery.integration(root,'work','main');self.assertTrue(report['integrated']);self.assertIn(commit,report['patchEquivalent'])

    def test_upload_verifies_consumer_and_reuses_existing_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source';source.mkdir();(source/'a').write_text('evidence')
            package=root/'package';delivery.pack(source,package,'r',1)
            issue=root/'.aikit/assistant/issues/AK-1';(issue/'attachments').mkdir(parents=True)
            attachments=[]
            for i,p in enumerate(package.iterdir()):
                (issue/'attachments'/p.name).write_bytes(p.read_bytes());attachments.append({'id':f'AK-1#a{i}', 'sha256':delivery.digest(p),'file':p.name})
            (issue/'issue.json').write_text(json.dumps({'attachments':attachments}))
            with patch.object(delivery.subprocess,'run',side_effect=AssertionError('must not reattach')):
                result=delivery.upload(root,'AK-1',package,root/'upload','ai-kit')
            self.assertTrue(result['complete']);self.assertEqual(len(result['verified']),2)

    def test_reuse_only_invalidates_changed_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'image').write_bytes(b'proof');h=delivery.digest(root/'image')
            (root/'ledger').write_text(json.dumps({'cases':[{'id':name,'inputs':{'asset':'a'},'evidence':[{'path':'image','sha256':h}]} for name in ['one','two']]}))
            (root/'inputs').write_text(json.dumps({'one':{'asset':'a'},'two':{'asset':'b'}}))
            report=delivery.ledger_check(root/'ledger',root/'inputs')
            self.assertTrue(report['cases'][0]['evidenceReusable']);self.assertFalse(report['cases'][1]['evidenceReusable'])


if __name__=='__main__':unittest.main()
