"""GP-0125: synthetic feature simulations and private reviewed 0.2.0 data loader."""
import hashlib
import json
import math
from pathlib import Path

FEATURES = ['r00','r10','r20','r01','r11','r21','faceScale','headGap','headOffset','shoulderRoll','shoulderScale','leftHandY','rightHandY','shouldersMask','leftHandMask','rightHandMask','dr00','dr10','dr20','dr01','dr11','dr21','gapVelocity','offsetVelocity','centerVX','centerVY']
POSTURES = ['neutral', 'forward', 'slouch', 'tilt']
ACTIVITIES = ['still', 'head_turn', 'translation', 'arm_raise', 'neck_motion']


def load_manifest(path):
    """No pseudo-labels: reviewed labels, consent, source hashes, person/capture isolation."""
    path = Path(path).resolve()
    manifest = json.loads(path.read_text(encoding='utf-8'))
    if manifest.get('schema') != 'face-motion-manifest-v2':
        raise ValueError('Expected face-motion-manifest-v2')
    groups = {r: [[], [], []] for r in ('train', 'validation', 'test')}
    people, captures, seen_files, intervals = {}, {}, set(), {}
    provenance = []
    for entry in manifest['files']:
        role, person, capture = entry['split'], entry['participantCode'], entry['captureId']
        if role not in groups or not person or not capture or entry.get('consent') is not True:
            raise ValueError('Invalid split/identity/consent')
        for owners, key in ((people, person), (captures, capture)):
            if key in owners and owners[key] != role:
                raise ValueError('Participant or capture crosses splits')
            owners[key] = role
        source = (path.parent / entry['path']).resolve()
        payload = source.read_bytes()
        digest = hashlib.sha256(payload).hexdigest()
        if digest != entry['sha256'] or digest in seen_files:
            raise ValueError('Changed or duplicate source')
        seen_files.add(digest)
        record = json.loads(payload)
        if record.get('schema') != 'face-motion-capture-v2' or record.get('features') != FEATURES or record.get('synthetic') is not False or record.get('participantCode') != person or record.get('captureId') != capture:
            raise ValueError('Capture schema or ownership mismatch')
        for window in record['windows']:
            p, a = window['posture'], window['activity']
            if window.get('reviewed') is not True or p not in POSTURES or a not in ACTIVITIES:
                raise ValueError('Unreviewed or invalid label')
            rows, times = window['sequence'], window['timesMs']
            if len(rows) != 40 or len(times) != 40 or any(len(row) != 26 or any(type(v) not in (int,float) or not math.isfinite(v) for v in row) for row in rows):
                raise ValueError('Invalid features')
            if any(type(t) not in (int,float) or not math.isfinite(t) for t in times) or any(not 75 <= b-a <= 350 for a,b in zip(times,times[1:])):
                raise ValueError('Invalid timestamps')
            if any(row[13] not in (0,1) or row[14] not in (0,1) or row[15] not in (0,1) for row in rows):
                raise ValueError('Invalid masks')
            spans = intervals.setdefault(capture, [])
            if any(not (times[-1] < start or times[0] > end) for start,end in spans):
                raise ValueError('Overlapping windows')
            spans.append((times[0],times[-1]))
            # No body labels from face-only evidence; no invisible-arm action supervision.
            posture = POSTURES.index(p) if all(r[13] for r in rows[-10:]) or p in ('neutral','tilt') else -100
            activity = ACTIVITIES.index(a) if a != 'arm_raise' or any(r[14] or r[15] for r in rows[-10:]) else -100
            groups[role][0].append(rows); groups[role][1].append(posture); groups[role][2].append(activity)
        provenance.append(dict(split=role, sha256=digest, windows=len(record['windows'])))
    for role, (_, p, a) in groups.items():
        if not set(range(4)).issubset(p) or not set(range(5)).issubset(a):
            raise ValueError(f'All observed classes required in {role}')
    return groups, dict(files=provenance, participants={r: sum(v==r for v in people.values()) for r in groups})
