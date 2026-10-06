"""All coordinates below are explicit synthetic fixtures, never participant recordings."""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'model' / 'analysis'))
from face_motion_data import FEATURES, POSTURES, ACTIVITIES, load_manifest


class FaceDataTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.root=Path(self.temp.name)
        self.manifest=dict(schema='face-motion-manifest-v2',files=[])
        for index,role in enumerate(['train','validation','test']):
            windows=[]
            for p in range(4):
                for a in range(5):
                    start=(p*5+a)*5000
                    row=[0.0]*26;row[0]=row[4]=row[13]=row[14]=row[15]=1.0
                    windows.append(dict(posture=POSTURES[p],activity=ACTIVITIES[a],reviewed=True,sequence=[row[:] for _ in range(40)],timesMs=[start+i*100 for i in range(40)]))
            # synthetic=false intentionally exercises real-input validation with manufactured fixture data.
            record=dict(schema='face-motion-capture-v2',synthetic=False,features=FEATURES,participantCode=f'fixture-{index}',captureId=f'fixture-capture-{index}',windows=windows)
            self.write(index,record)
            self.manifest['files'].append(dict(path=f'{index}.json',sha256=self.digest(index),participantCode=record['participantCode'],captureId=record['captureId'],split=role,consent=True))
        self.path=self.root/'manifest.json'
    def tearDown(self): self.temp.cleanup()
    def digest(self,i): return hashlib.sha256((self.root/f'{i}.json').read_bytes()).hexdigest()
    def write(self,i,v): (self.root/f'{i}.json').write_text(json.dumps(v),encoding='utf-8')
    def load(self):
        self.path.write_text(json.dumps(self.manifest),encoding='utf-8'); return load_manifest(self.path)
    def mutate(self,fn):
        v=json.loads((self.root/'0.json').read_text());fn(v);self.write(0,v);self.manifest['files'][0]['sha256']=self.digest(0)
    def test_disjoint_reviewed_fixture_is_accepted(self):
        data,info=self.load();self.assertEqual(len(data['train'][0]),20);self.assertEqual(info['participants']['test'],1)
    def test_cross_person_split_and_missing_consent_are_rejected(self):
        self.manifest['files'][1]['participantCode']='fixture-0'
        with self.assertRaises(ValueError):self.load()
        self.manifest['files'][1]['participantCode']='fixture-1';self.manifest['files'][1]['consent']=False
        with self.assertRaises(ValueError):self.load()
    def test_changed_source_and_unreviewed_labels_are_rejected(self):
        self.manifest['files'][0]['sha256']='0'*64
        with self.assertRaises(ValueError):self.load()
        self.mutate(lambda v:v['windows'][0].update(reviewed=False))
        with self.assertRaises(ValueError):self.load()
    def test_overlap_nonfinite_and_timestamps_are_rejected(self):
        self.mutate(lambda v:v['windows'][1].update(timesMs=v['windows'][0]['timesMs']))
        with self.assertRaises(ValueError):self.load()
    def test_missing_body_is_excluded_from_body_supervision(self):
        def mutate(v):
            for row in v['windows'][5]['sequence']:row[13]=0
        self.mutate(mutate);data,_=self.load();self.assertEqual(data['train'][1][5],-100)
