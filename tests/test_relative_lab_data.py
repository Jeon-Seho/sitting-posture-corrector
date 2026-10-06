import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from model.analysis.relative_lab_data import load_manifest
from model.analysis.train_relative_lab import sequence


class ReviewedManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.manifest = dict(version=1, consentConfirmed=True, featureVersion='relative-delta-velocity-v1',
            participantsBySplit=dict(train=['synthetic-fixture-P1'], validation=['synthetic-fixture-P2'], test=['synthetic-fixture-P3']), captures=[])
        # Explicit fixtures simulate reviewed document format, not actual people.
        for index, role in enumerate(('train', 'validation', 'test')):
            person = self.manifest['participantsBySplit'][role][0]
            doc = dict(version=1, synthetic=False, participantCode=person, captureId=str(index), featureVersion=self.manifest['featureVersion'],
                records=[dict(label=label, reviewed=True, sequence=sequence(index*100+label,label), timesMs=[label*4000+t*100 for t in range(30)]) for label in range(3)])
            file = self.root / f'{index}.json'
            file.write_text(json.dumps(doc), encoding='utf-8')
            self.manifest['captures'].append(dict(path=file.name, sha256=hashlib.sha256(file.read_bytes()).hexdigest(), participantCode=person))

    def tearDown(self):
        self.temp.cleanup()

    def load(self):
        path = self.root / 'manifest.json'
        path.write_text(json.dumps(self.manifest), encoding='utf-8')
        return load_manifest(path)

    def test_disjoint_reviewed_fixtures_load(self):
        groups, _ = self.load()
        self.assertEqual([len(groups[r][0]) for r in ('train','validation','test')], [3,3,3])

    def test_participant_overlap_is_rejected(self):
        self.manifest['participantsBySplit']['test'] = self.manifest['participantsBySplit']['train']
        with self.assertRaisesRegex(ValueError, 'overlap'): self.load()

    def test_modified_source_is_rejected(self):
        (self.root/'0.json').write_text('{}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'hash'): self.load()

    def test_unreviewed_labels_and_missing_time_are_rejected(self):
        file = self.root/'0.json'
        doc = json.loads(file.read_text(encoding='utf-8')); doc['records'][0]['reviewed'] = False
        file.write_text(json.dumps(doc), encoding='utf-8'); self.manifest['captures'][0]['sha256'] = hashlib.sha256(file.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, 'reviewed'): self.load()

    def test_overlapping_windows_are_rejected(self):
        file = self.root/'0.json'
        doc = json.loads(file.read_text(encoding='utf-8')); doc['records'][1]['timesMs'] = doc['records'][0]['timesMs']
        file.write_text(json.dumps(doc), encoding='utf-8'); self.manifest['captures'][0]['sha256'] = hashlib.sha256(file.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, 'Overlapping'): self.load()
