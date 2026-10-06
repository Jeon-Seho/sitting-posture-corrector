"""Reviewed feature windows, hashed sources and participant-disjoint split validation."""
import hashlib
import json
import math
from pathlib import Path

ROLES = ('train', 'validation', 'test')


def load_manifest(path):
    source = Path(path).resolve()
    manifest = json.loads(source.read_text(encoding='utf-8'))
    if manifest.get('version') != 1 or manifest.get('featureVersion') != 'relative-delta-velocity-v1':
        raise ValueError('Unsupported manifest feature version')
    if manifest.get('consentConfirmed') is not True:
        raise ValueError('Explicit collection consent confirmation required')
    splits = manifest.get('participantsBySplit', {})
    if set(splits) != set(ROLES):
        raise ValueError('Explicit train/validation/test participants required')
    all_people = []
    for role in ROLES:
        people = splits[role]
        if not isinstance(people, list) or not people or any(not isinstance(p, str) or not p for p in people):
            raise ValueError('Each split needs participant codes')
        all_people.extend(people)
    if len(all_people) != len(set(all_people)):
        raise ValueError('Participants overlap across splits')
    result = {role: ([], []) for role in ROLES}
    captures, hashes, intervals = set(), set(), {}
    files = manifest.get('captures')
    if not isinstance(files, list) or not files:
        raise ValueError('No captures supplied')
    for entry in files:
        file_path = (source.parent / entry['path']).resolve()
        raw = file_path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest != entry['sha256'] or digest in hashes:
            raise ValueError('Capture hash mismatch or duplicate file')
        hashes.add(digest)
        document = json.loads(raw.decode('utf-8'))
        person, capture = document.get('participantCode'), document.get('captureId')
        if person != entry.get('participantCode') or not capture or capture in captures:
            raise ValueError('Capture ownership mismatch or duplicate capture')
        captures.add(capture)
        role = next((r for r in ROLES if person in splits[r]), None)
        if role is None or document.get('synthetic') is not False or document.get('featureVersion') != manifest['featureVersion']:
            raise ValueError('Unassigned or incompatible capture')
        rows, labels = result[role]
        for record in document.get('records', []):
            label, sequence, times = record.get('label'), record.get('sequence'), record.get('timesMs')
            if record.get('reviewed') is not True or type(label) is not int or label not in (0, 1, 2):
                raise ValueError('Only explicitly reviewed 3-class labels accepted')
            if not isinstance(sequence, list) or len(sequence) != 30 or any(not isinstance(row, list) or len(row) != 6 or any(type(v) not in (int, float) or not math.isfinite(v) for v in row) for row in sequence):
                raise ValueError('Expected 30 by 6 finite feature sequence')
            if not isinstance(times, list) or len(times) != 30 or any(type(t) not in (int, float) or not math.isfinite(t) for t in times):
                raise ValueError('Observed timestamps required')
            if any(not 75 <= times[i] - times[i-1] <= 350 for i in range(1, 30)):
                raise ValueError('Reversed, duplicated or missing observed frames')
            span = (times[0], times[-1])
            if any(span[0] <= previous[1] and previous[0] <= span[1] for previous in intervals.get(capture, [])):
                raise ValueError('Overlapping reviewed windows are not independent samples')
            intervals.setdefault(capture, []).append(span)
            rows.append(sequence); labels.append(label)
    if any(set(labels) != {0, 1, 2} for _, labels in result.values()):
        raise ValueError('Every split must include all three reviewed classes')
    return result, dict(participantsBySplit=splits, sourceHashes=sorted(hashes), manifestHash=hashlib.sha256(source.read_bytes()).hexdigest())
