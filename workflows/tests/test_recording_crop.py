"""Synthetic recording crop and decoded frame identity regression."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recording_sheet import recording_sheet


class RecordingCropTests(unittest.TestCase):
    def test_video_crop_and_ordinals_match_single_frame_decode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / 'motion.webm'
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
                            'testsrc2=size=64x48:rate=10:duration=1', '-c:v', 'libvpx-vp9', str(video)], check=True)
            (root / 'motion.json').write_text(json.dumps(dict(sha256=hashlib.sha256(video.read_bytes()).hexdigest())))
            request = root / 'spec.json'
            request.write_text(json.dumps(dict(recording='motion.json', crop=[8, 4, 32, 24],
                                              event=dict(name='sample', frame=4, observation='Synthetic frame identity check'),
                                              beforeMs=200, afterMs=200, intervalMs=100)))
            recording_sheet(request, root / 'sheet', root)
            report = json.loads((root / 'sheet/sheet.json').read_text())
            self.assertEqual(report['encodedSize'], dict(width=64, height=48))
            self.assertEqual(report['crop'], [8, 4, 32, 24])
            self.assertEqual([row['frame'] for row in report['overview']], list(range(10)))
            self.assertTrue(report['windowFullyRecorded'])
            expected = root / 'expected.png'
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(video), '-vf',
                            'select=eq(n\\,4),crop=32:24:8:4,scale=240:-1', '-frames:v', '1', str(expected)], check=True)
            self.assertEqual((root / 'sheet/frame-000004.png').read_bytes(), expected.read_bytes())
            request.write_text(json.dumps(dict(recording='motion.json', crop=[60, 0, 32, 24])))
            with self.assertRaisesRegex(ValueError, '64x48'):
                recording_sheet(request, root / 'bad', root)
            self.assertFalse((root / 'bad').exists())

            # Unity uses saved frame IDs and reduced image dimensions, not video ordinals.
            (root / 'record.json').write_text(json.dumps(dict(frameSize=dict(width=240, height=180),
                frames=[dict(frame=400, t=0.0, file='expected.png'), dict(frame=407, t=0.25, file='expected.png')])))
            request.write_text(json.dumps(dict(recording='record.json', crop=[0, 0, 120, 90],
                event=dict(name='unity', frame=407, observation='Saved frame ID'), beforeMs=250, afterMs=1, intervalMs=250)))
            recording_sheet(request, root / 'unity-sheet', root)
            report = json.loads((root / 'unity-sheet/sheet.json').read_text())
            self.assertEqual([row['frame'] for row in report['window']], [400, 407])
            self.assertFalse(report['windowFullyRecorded'])
            self.assertEqual(report['encodedSize'], dict(width=240, height=180))
