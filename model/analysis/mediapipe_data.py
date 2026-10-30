"""Strict stdlib-only preparation of private /dev MediaPipe collection exports."""
from __future__ import annotations

from collections import Counter
from bisect import bisect_left
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
ORDER = [0, 6, 5, 4, 1, 2, 3, 10, 9, 7, 8, 11, 12]
FEATURE_DEFINITION = 'mediapipe-world13-shoulder-normalized-xyz-v1'
POINT_DEFINITION = 'MediaPipe-13-world-shoulder-normalized-v1'
COLLECTION_FEATURE = 'mediapipe-shoulder-normalized-centroids-v1'
SPLITS = ('train', 'validation', 'test')
LABELS = ('manual_confirmed', 'automatic_weak')
MAX_GAP_MS = 250
GRID_MS = 100
STEPS = 30
HORIZON = 3
TARGET_TOLERANCE_MS = 50
KNOWN_POSE_MODELS = frozenset(f'mediapipe-pose-{variant}-f16-v1/tasks-vision-1.0.1' for variant in ('lite', 'full', 'heavy'))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def vector(value, length=39):
    return isinstance(value, list) and len(value) == length and all(number(x) and abs(x) < 100 for x in value)


def code(value):
    return isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_-]{2,48}', value) is not None


def private_path(path):
    """Permit explicit external paths or ignored data/runs; never tracked source assets."""
    path = Path(path).expanduser().resolve()
    if path.is_relative_to(ROOT):
        require(any(path.is_relative_to(ROOT / name) for name in ('data', 'runs')),
                'Private inputs/outputs must be outside the repository or under ignored data/ or runs/.')
    return path


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path):
    path = private_path(path)
    require(path.stat().st_size <= 64 * 1024 * 1024, 'Collection/manifest exceeds the 64 MiB input limit.')
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, f'Duplicate JSON key: {key}')
            result[key] = value
        return result
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=pairs,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f'Non-finite JSON value: {value}')))


def normalized_values(image, world):
    require(isinstance(image, list) and len(image) == 13 and isinstance(world, list) and len(world) == 13,
            'Expected exactly 13 raw MediaPipe image/world points.')
    for p, q in zip(image, world):
        require(isinstance(p, dict) and isinstance(q, dict), 'Invalid point object.')
        require(all(number(p.get(axis)) and number(q.get(axis)) for axis in ('x', 'y', 'z')),
                'Point coordinates must be finite.')
        require(0 <= p['x'] <= 1 and 0 <= p['y'] <= 1 and number(p.get('visibility')) and .5 <= p['visibility'] <= 1,
                'Unmeasurable point: out of frame or visibility below 0.5.')
    left, right = world[11], world[12]
    span = math.dist([left[a] for a in ('x', 'y', 'z')], [right[a] for a in ('x', 'y', 'z')])
    require(span >= .05, 'Unmeasurable shoulder span.')
    center = [(left[a] + right[a]) / 2 for a in ('x', 'y', 'z')]
    result = [(world[i][axis] - center[j]) / span for i in ORDER for j, axis in enumerate(('x', 'y', 'z'))]
    require(vector(result), 'Normalized coordinates are outside the supported finite range.')
    return result


def distance(first, second):
    points = [math.dist(first[i:i + 3], second[i:i + 3]) for i in range(0, 39, 3)]
    return (sum(points[:9]) / 9 + sum(points[9:11]) / 2 + sum(points[11:]) / 2) / 3


@dataclass(frozen=True)
class Frame:
    participant: str
    key: tuple
    time: float
    video_time: float
    values: tuple[float, ...]
    label: str


@dataclass(frozen=True)
class Window:
    participant: str
    key: tuple
    input_start_ms: float
    input_end_ms: float
    target_ms: float
    nominal_target_ms: float
    input_observed_through_ms: float
    inputs: tuple[tuple[float, ...], ...]
    target: tuple[float, ...]
    label: str


def checked_frame(row, expected_model):
    require(isinstance(row, dict), 'Frame must be an object.')
    require(row.get('poseModelId') == expected_model,
            'Missing or mismatched poseModelId: collect again with the manifest extractor model.')
    require(all(number(row.get(key)) and row[key] > 0 for key in ('width', 'height')), 'Invalid frame dimensions.')
    require(type(row.get('segment')) is int and row['segment'] >= 0, 'Invalid segment.')
    values = normalized_values(row.get('image'), row.get('world'))
    require(vector(row.get('values')) and all(abs(a - b) <= 1e-7 for a, b in zip(values, row['values'])),
            'Stored values do not match the raw MediaPipe coordinates/point definition.')
    for clock in ('timeMs', 'videoTimeMs'):
        require(number(row.get(clock)) and row[clock] >= 0, f'Invalid {clock}.')
    return tuple(values)


def _manual_frames(data, expected_model, label, kind):
    """Validate shared explicit-capture clocks, quality boundaries and raw points."""
    meta = data.get('metadata', {})
    require(isinstance(meta, dict) and code(meta.get('participantCode')) and code(meta.get('sessionCode')), f'Invalid {kind} participant/session metadata.')
    require(meta.get('poseModelId') == expected_model, f'{kind} metadata poseModelId is missing or mismatched.')
    timing = data.get('timing', {})
    require(isinstance(timing, dict) and timing.get('unit') == 'ms' and timing.get('maxGapMs') == MAX_GAP_MS and timing.get('interpolation') is False,
            f'Unsupported {kind} timing/interpolation contract.')
    rows = data.get('frames')
    require(isinstance(rows, list) and 100 <= len(rows) <= 1200, f'Confirmed {kind} export needs 100–1200 frames.')
    gaps = data.get('gaps')
    require(isinstance(gaps, list) and len(gaps) <= 600 and all(isinstance(gap, dict) and number(gap.get('timeMs')) and
            gap['timeMs'] >= 0 and gap.get('reason') in ('quality', 'gap', 'hidden', 'interrupted') for gap in gaps),
            f'{kind} quality gaps must have valid times and reasons.')
    gap_times = [gap['timeMs'] for gap in gaps]
    require(gap_times == sorted(gap_times), f'{kind} gap clocks reversed.')
    previous, duration, frames = None, 0., []
    for row in rows:
        values = checked_frame(row, expected_model)
        if previous:
            require(row['timeMs'] > previous['timeMs'] and row['videoTimeMs'] > previous['videoTimeMs'], f'{kind} clocks reversed or duplicated.')
            require(row['segment'] != previous['segment'] or not any(previous['timeMs'] < gap <= row['timeMs'] for gap in gap_times),
                    f'{kind} quality gap must separate segments; missing observations cannot be bridged.')
            if row['segment'] == previous['segment'] and row['timeMs'] - previous['timeMs'] <= MAX_GAP_MS:
                duration += row['timeMs'] - previous['timeMs']
        key = (data['id'], meta['sessionCode'], row['segment'])
        frames.append(Frame(meta['participantCode'], key, row['timeMs'], row['videoTimeMs'], values, label))
        previous = row
    require(duration >= 30_000 and number(data.get('validMs')) and abs(duration - data['validMs']) <= 1e-5,
            f'{kind} validMs does not match at least 30 seconds of adjacent observations.')
    return frames


def evaluation_frames(data, expected_model):
    """Read only dedicated held-out captures; this function never fits a profile/model."""
    require(isinstance(data, dict) and isinstance(data.get('id'), str) and data['id'], 'Missing evaluation collection ID.')
    require(data.get('schema_version') == 'forecast-evaluation-collection-v1', 'Expected dedicated forecast-evaluation-collection-v1 schema.')
    require(expected_model in KNOWN_POSE_MODELS, 'Evaluation requires a supported poseModelId extractor.')
    require(data.get('source') == 'webcam' and data.get('collectionMethod') == 'manual_30s', 'Evaluation requires an explicit manual webcam capture.')
    require(data.get('dataRole') == 'evaluation_only' and data.get('trainingAllowed') is False and
            data.get('review') == 'user_confirmed_evaluation', 'Evaluation must be confirmed and marked evaluation_only with trainingAllowed false.')
    require(not any(key in data for key in ('label', 'labelDisplay', 'profile')), 'Evaluation cannot contain normal labels or a fitted profile.')
    meta = data.get('metadata')
    require(isinstance(meta, dict) and meta.get('purpose') == 'forecast_evaluation', 'Evaluation metadata purpose must be forecast_evaluation.')
    require(data.get('featureVersion') == COLLECTION_FEATURE, 'Unsupported evaluation featureVersion.')
    timing = data.get('timing')
    require(isinstance(timing, dict) and timing.get('origin') == 'explicit_collection_start' and timing.get('preparationMs') == 3000,
            'Evaluation timing must exclude the 3000 ms preparation period.')
    frames = _manual_frames(data, expected_model, 'evaluation_only', 'Evaluation')
    require(all(3000 <= frame.time < 120_000 for frame in frames), 'Evaluation frames must exclude preparation and stay within the 2-minute capture limit.')
    require(all(not any(key in row for key in ('label', 'labelDisplay', 'profile')) for row in data['frames']),
            'Evaluation frames cannot contain normal labels or a fitted profile.')
    return frames


def _reject_evaluation_training(data):
    require('reviewGate' not in data, 'Review-required collection is blocked from training; preserve it and complete a separate manual review first.')
    meta = data.get('metadata')
    require(data.get('schema_version') != 'forecast-evaluation-collection-v1' and data.get('dataRole') != 'evaluation_only' and
            data.get('trainingAllowed') is not False and not (isinstance(meta, dict) and meta.get('purpose') == 'forecast_evaluation'),
            'Evaluation-only captures are forbidden in training preparation and pilot manifests; use the frozen-model evaluation command.')


def collection_frames(data, expected_model, mode):
    require(isinstance(data, dict) and isinstance(data.get('id'), str) and data['id'], 'Missing collection ID.')
    _reject_evaluation_training(data)
    require(data.get('source') == 'webcam', 'Only webcam collection exports are supported.')
    schema = data.get('schema_version')
    frames = []
    if schema == 'normal-posture-collection-v1':
        require(data.get('label') == 'normal_assumed' and data.get('review') == 'user_confirmed_normal',
                'Manual data must be user-confirmed normal, not a pending review.')
        require(data.get('featureVersion') == COLLECTION_FEATURE, 'Unsupported manual featureVersion.')
        meta = data.get('metadata', {})
        require(isinstance(meta, dict) and code(meta.get('participantCode')) and code(meta.get('sessionCode')), 'Invalid manual participant/session metadata.')
        require(meta.get('poseModelId') == expected_model, 'Manual metadata poseModelId is missing or mismatched.')
        require(meta.get('purpose') in ('training_normal', 'personal_calibration'), 'Unknown manual collection purpose.')
        require(mode == 'pilot' or meta['purpose'] == 'training_normal',
                'personal_calibration data is excluded from participant-holdout training/evaluation; use training_normal exports.')
        frames = _manual_frames(data, expected_model, 'manual_confirmed', 'Manual')
    elif schema in ('normal-posture-auto-collection-v1', 'normal-posture-auto-collection-v2'):
        label = {'label': 'normal_auto_assumed', 'labelSource': 'auto_rule', 'review': 'not_reviewed'}
        require(all(data.get(k) == v for k, v in label.items()) and data.get('purpose') == 'early_experiment_only' and data.get('domainValidated') is False,
                'Automatic weak-label provenance is invalid.')
        selection = data.get('selection', {})
        require(isinstance(selection, dict) and selection.get('metric') == 'balanced_face_ears_shoulders_distance' and selection.get('inclusive') is True and
                selection.get('maximumHz') == 10 and selection.get('interpolation') is False, 'Unsupported automatic selection contract.')
        v2 = schema.endswith('-v2')
        clean_gate = selection.get('cleanGate')
        if clean_gate is not None:
            require(clean_gate == {'policy': 'auto-normal-clean-v1', 'maximumPostureScore': .5, 'minimumStableMs': 1000,
                                   'requiredRuleState': 'near_reference', 'imagePosturePolicy': 'image-posture-anchor-v2'},
                    'Unsupported automatic clean selection policy.')
        if v2:
            require(selection.get('thresholdSource') == 'row.maximumDeviation' and
                    selection.get('allowedMaximumDeviations') == [.005, .03, .06] and
                    selection.get('configuredMaximumDeviation') in (.005, .03, .06), 'Unsupported v2 row thresholds.')
        else:
            require(selection.get('maximumDeviation') == .005, 'v1 automatic threshold must be 0.005.')
        timing = data.get('timing', {})
        require(isinstance(timing, dict) and timing.get('unit') == 'ms' and timing.get('maximumGapMs') == MAX_GAP_MS, 'Unsupported automatic timing contract.')
        references = data.get('references')
        require(isinstance(references, list) and references, 'Automatic references are missing.')
        refs = {}
        for ref in references:
            require(isinstance(ref, dict) and isinstance(ref.get('id'), str) and ref['id'] not in refs and
                    isinstance(ref.get('runId'), str) and code(ref.get('participantCode')) and
                    ref.get('poseModelId') == expected_model and vector(ref.get('values')) and
                    number(ref.get('observationTimeMs')) and ref['observationTimeMs'] >= 0, 'Invalid/duplicate/mismatched automatic reference.')
            refs[ref['id']] = ref
        rows = data.get('rows')
        require(isinstance(rows, list) and 0 < len(rows) <= 6000, 'Automatic export needs 1–6000 rows.')
        last_source = -1
        run_clocks = {}
        for index, row in enumerate(rows):
            values = checked_frame(row, expected_model)
            if clean_gate is not None:
                require(row.get('selectionPolicy') == clean_gate['policy'] and row.get('imagePosturePolicy') == clean_gate['imagePosturePolicy'] and
                        number(row.get('postureScore')) and 0 <= row['postureScore'] <= clean_gate['maximumPostureScore'] and
                        number(row.get('imagePostureScore')) and 0 <= row['imagePostureScore'] <= row['postureScore'] and
                        number(row.get('stableForMs')) and number(row.get('observationTimeMs')) and
                        clean_gate['minimumStableMs'] <= row['stableForMs'] <= row['observationTimeMs'],
                        'Row fails automatic clean selection provenance/score/stability bounds.')
            require(type(row.get('row')) is int and row['row'] == index + 1, 'Automatic row numbers must be contiguous and ordered.')
            require(row['timeMs'] > last_source, 'Automatic observation clocks reversed or duplicated.')
            last_source = row['timeMs']
            require(number(row.get('observationTimeMs')) and row['observationTimeMs'] >= 0 and code(row.get('participantCode')), 'Invalid automatic participant/clock.')
            ref = refs.get(row.get('referenceId'))
            require(ref is not None and row.get('runId') == ref['runId'] and row['participantCode'] == ref['participantCode'] and
                    row['observationTimeMs'] >= ref['observationTimeMs'], 'Automatic reference ownership or chronology mismatch.')
            previous = run_clocks.get(row['runId'])
            require(previous is None or (row['observationTimeMs'] > previous[0] and row['videoTimeMs'] > previous[1]), 'Automatic run/video clocks reversed or duplicated.')
            run_clocks[row['runId']] = (row['observationTimeMs'], row['videoTimeMs'])
            require(all(row.get(k) == v for k, v in label.items()), 'Row weak-label provenance differs from the export.')
            threshold = row.get('maximumDeviation') if v2 else .005
            require(number(threshold) and threshold in (.005, .03, .06), 'Unknown automatic row threshold.')
            deviation = distance(values, ref['values'])
            require(number(row.get('deviation')) and 0 <= row['deviation'] <= threshold and abs(deviation - row['deviation']) <= 1e-7,
                    'Automatic row deviation does not match its reference/selection threshold.')
            key = (data['id'], row['runId'], row['referenceId'], row['segment'], threshold)
            frames.append(Frame(row['participantCode'], key, row['observationTimeMs'], row['videoTimeMs'], values, 'automatic_weak'))
    else:
        raise ValueError('Unsupported collection schema; import normal manual v1 or automatic v1/v2.')
    return frames


def continuous_segments(frames):
    segments, current = [], []
    for frame in frames:
        previous = current[-1] if current else None
        if previous and (frame.participant != previous.participant or frame.key != previous.key or
                         frame.label != previous.label or not 0 < frame.time - previous.time <= MAX_GAP_MS or
                         not 0 < frame.video_time - previous.video_time <= MAX_GAP_MS):
            segments.append(current); current = []
        current.append(frame)
    if current:
        segments.append(current)
    return segments


def resample(segment):
    """Anchor to the first real point; interpolate only within adjacent valid endpoints."""
    first, last = segment[0].time, segment[-1].time
    output, right = [], 0
    for index in range(math.floor((last - first) / GRID_MS) + 1):
        time = first + index * GRID_MS
        while right < len(segment) and segment[right].time < time:
            right += 1
        if right == len(segment):
            break
        after = segment[right]
        if after.time == time:
            values = after.values
        else:
            require(right > 0, 'Interpolation cannot extrapolate.')
            before = segment[right - 1]
            require(0 < after.time - before.time <= MAX_GAP_MS, 'Interpolation cannot bridge missing observations.')
            ratio = (time - before.time) / (after.time - before.time)
            values = tuple(a + ratio * (b - a) for a, b in zip(before.values, after.values))
        output.append((time, values))
    return output


def windows_for_frames(frames, diagnostics=None, maximum_windows=None):
    windows = []
    for segment in continuous_segments(frames):
        grid = resample(segment)
        observed_times = [frame.time for frame in segment]
        for start in range(max(0, len(grid) - STEPS - HORIZON + 1)):
            if diagnostics is not None:
                diagnostics['candidate_windows'] += 1
            inputs = grid[start:start + STEPS]
            nominal = grid[start + STEPS + HORIZON - 1][0]
            right = bisect_left(observed_times, nominal)
            candidates = [segment[index] for index in (right - 1, right) if 0 <= index < len(segment)]
            target = min(candidates, key=lambda frame: (abs(frame.time - nominal), frame.time))
            observed_through = observed_times[bisect_left(observed_times, inputs[-1][0])]
            if abs(target.time - nominal) > TARGET_TOLERANCE_MS or observed_through >= target.time:
                if diagnostics is not None:
                    diagnostics['discarded_target_windows'] += 1
                continue
            require(maximum_windows is None or len(windows) < maximum_windows,
                    'Too many windows: use a smaller reviewed manifest or explicitly raise --maximum-windows.')
            windows.append(Window(segment[0].participant, segment[0].key, inputs[0][0], inputs[-1][0], target.time,
                                  nominal, observed_through, tuple(row[1] for row in inputs), target.values, segment[0].label))
    return windows


@dataclass
class Prepared:
    pose_model_id: str
    mode: str
    windows: dict[str, list[Window]]
    report: dict


def prepare(manifest_path, mode='participant_holdout', maximum_windows=20_000):
    require(mode in ('participant_holdout', 'pilot'), 'Unknown training mode.')
    require(type(maximum_windows) is int and maximum_windows > 0, 'maximum_windows must be positive.')
    manifest_path = private_path(manifest_path)
    manifest = read_json(manifest_path)
    require(isinstance(manifest, dict) and manifest.get('schema_version') == 'mediapipe-lstm-manifest-v1', 'Unsupported manifest schema.')
    expected_model = manifest.get('poseModelId')
    require(isinstance(expected_model, str) and expected_model in KNOWN_POSE_MODELS,
            'Manifest poseModelId must identify an exact supported Lite/Full/Heavy extractor version.')
    participants = manifest.get('participants')
    require(isinstance(participants, dict) and set(participants) == set(SPLITS), 'Manifest requires explicit train/validation/test participant lists.')
    owners = {}
    for split in SPLITS:
        values = participants[split]
        require(isinstance(values, list) and all(code(value) for value in values), 'Participant codes are invalid.')
        for participant in values:
            require(participant not in owners, 'Participant overlap/duplicate across manifest splits is forbidden.')
            owners[participant] = split
    require(participants['train'], 'Training participant list is empty.')
    if mode == 'pilot':
        require(not participants['validation'] and not participants['test'], 'Pilot is train-only; validation/test participants must never be moved into fitting.')
    else:
        require(participants['validation'] and participants['test'], 'Participant-holdout mode needs separate validation and test participants.')
    files = manifest.get('files')
    require(isinstance(files, list) and 0 < len(files) <= 100, 'Manifest needs 1–100 explicit hashed files.')
    partitions = {split: [] for split in SPLITS}
    window_diagnostics = {split: Counter() for split in SPLITS}
    sources, seen_ids, seen_hashes, observed = [], set(), set(), set()
    frame_counts = Counter()
    for item in files:
        require(isinstance(item, dict) and isinstance(item.get('path'), str) and isinstance(item.get('sha256'), str) and
                re.fullmatch(r'[0-9a-f]{64}', item['sha256']), 'Each input needs a path and SHA-256 fingerprint.')
        source = private_path(manifest_path.parent / item['path'])
        digest = sha256(source)
        require(digest == item['sha256'], 'Input SHA-256 mismatch; inspect the changed data and create a reviewed manifest.')
        require(digest not in seen_hashes, 'Duplicate source file in manifest.')
        seen_hashes.add(digest)
        data = read_json(source)
        require(isinstance(data, dict) and isinstance(data.get('id'), str), 'Collection must be an object with an ID.')
        require(data.get('id') not in seen_ids, 'Repeated collection ID: overlapping exports must not count as independent data.')
        seen_ids.add(data.get('id'))
        frames = collection_frames(data, expected_model, mode)
        for frame in frames:
            require(frame.participant in owners, 'A data participant is missing from the explicit split manifest.')
            observed.add(frame.participant)
            frame_counts[owners[frame.participant]] += 1
        # Split owners before windowing; grouping and segment checks also prevent session/reference bridges.
        for segment in continuous_segments(frames):
            split = owners[segment[0].participant]
            remaining = maximum_windows - sum(map(len, partitions.values()))
            partitions[split].extend(windows_for_frames(segment, window_diagnostics[split], remaining))
        require(sum(map(len, partitions.values())) <= maximum_windows, 'Too many windows: use a smaller reviewed manifest or explicitly raise --maximum-windows.')
        sources.append({'sha256': digest, 'schema': data['schema_version'], 'frames': len(frames)})
    require(set(owners) == observed, 'Manifest includes participants with no source observations.')
    required = ('train',) if mode == 'pilot' else SPLITS
    for split in required:
        require(partitions[split], f'No usable {split} windows. Need at least 3.2 seconds within one quality-valid segment (33 × 100 ms samples) and a real future target within ±50 ms; collect more continuous data.')
        require({window.participant for window in partitions[split]} == set(participants[split]),
                f'Some {split} participants have no usable continuous windows; collect more data before training.')
    counts = {split: len(partitions[split]) for split in SPLITS}
    participant_counts = {split: len(participants[split]) for split in SPLITS}
    labels = Counter(window.label for window in partitions['train'])
    training = {'mode': mode,
                'evaluation_scope': 'training_fit_only' if mode == 'pilot' else 'participant_holdout_forecast_only',
                'participant_generalization_evaluated': False,
                'labels_used': {'manual_confirmed_windows': labels['manual_confirmed'], 'automatic_weak_windows': labels['automatic_weak']},
                'split_window_counts': counts, 'split_participant_counts': participant_counts}
    report = {'schema_version': 'mediapipe-training-report-v1', 'pose_model_id': expected_model,
              'feature_definition': FEATURE_DEFINITION, 'point_definition': POINT_DEFINITION,
              'domain_validated': False, 'posture_accuracy': None, 'training': training,
              'frame_counts': {split: frame_counts[split] for split in SPLITS}, 'sources': sources,
              'manifest_sha256': sha256(manifest_path), 'explicit_synthetic': manifest.get('explicitSynthetic') is True,
              'windowing': {'steps': STEPS, 'dimensions': 39, 'interval_ms': GRID_MS, 'horizon_ms': HORIZON * GRID_MS,
                            'stride_ms': GRID_MS, 'maximum_gap_ms': MAX_GAP_MS, 'anchor': 'first_observed_frame_of_segment'},
              'targets': {'source': 'actual_observed_coordinates_only', 'tolerance_ms': TARGET_TOLERANCE_MS,
                          'interpolated_targets': False, 'tie_break': 'earlier_observation',
                          'per_split': {split: {'candidate_windows': window_diagnostics[split]['candidate_windows'],
                                               'discarded_target_windows': window_diagnostics[split]['discarded_target_windows'],
                                               'actual_horizon_min_ms': min((w.target_ms - w.input_end_ms for w in partitions[split]), default=None),
                                               'actual_horizon_max_ms': max((w.target_ms - w.input_end_ms for w in partitions[split]), default=None),
                                               'effective_horizon_min_ms': min((w.target_ms - w.input_observed_through_ms for w in partitions[split]), default=None),
                                               'effective_horizon_max_ms': max((w.target_ms - w.input_observed_through_ms for w in partitions[split]), default=None),
                                               'maximum_absolute_offset_ms': max((abs(w.target_ms - w.nominal_target_ms) for w in partitions[split]), default=None)} for split in SPLITS}},
              'limitations': ['Normal-only coordinate forecasting is not posture classification or correction efficacy.',
                             'Automatic labels are unreviewed rule-selected weak labels, not evaluation ground truth.',
                             'Automatic thresholds select a narrow distribution; held-out forecast error is not posture accuracy.',
                             'The model forecasts nominally 300 ms; observed targets may differ by ±50 ms. CV baselines use the actual target horizon.']}
    return Prepared(expected_model, mode, partitions, report)


def create_pilot_manifest(paths, output):
    """Inspect explicit normal collections; never automatically assign evaluation participants."""
    require(0 < len(paths) <= 100, 'manifest requires 1–100 explicit collection file paths.')
    output = private_path(output)
    require(not output.exists(), 'Choose a new manifest file; existing manifests are never overwritten.')
    files, participants, seen_ids, seen_hashes = [], set(), set(), set()
    expected_model, usable_windows, explicit_synthetic = None, 0, True
    for raw_path in paths:
        source = private_path(raw_path)
        data = read_json(source)
        require(isinstance(data, dict), 'Collection must be an object.')
        _reject_evaluation_training(data)
        explicit_synthetic = explicit_synthetic and data.get('explicitSynthetic') is True
        if data.get('schema_version') == 'normal-posture-collection-v1':
            meta = data.get('metadata')
            require(isinstance(meta, dict), 'Missing manual metadata.')
            current_model = meta.get('poseModelId')
        else:
            references = data.get('references')
            require(isinstance(references, list) and references and isinstance(references[0], dict), 'Missing automatic references.')
            current_model = references[0].get('poseModelId')
        require(isinstance(current_model, str) and current_model in KNOWN_POSE_MODELS,
                'Missing/unknown poseModelId: collect again with a supported extractor.')
        require(expected_model is None or current_model == expected_model, 'Mixed poseModelId extractors cannot share a manifest.')
        expected_model = current_model
        frames = collection_frames(data, expected_model, 'pilot')
        digest = sha256(source)
        require(data['id'] not in seen_ids and digest not in seen_hashes, 'Duplicate collection/file; overlapping exports are not independent data.')
        seen_ids.add(data['id']); seen_hashes.add(digest)
        participants.update(frame.participant for frame in frames)
        require(len(participants) == 1, 'Automatic manifest creation is single-participant pilot only; define multi-participant holdout splits explicitly.')
        # Count without retaining all windows across files, and apply the same default budget.
        usable_windows += len(windows_for_frames(frames, maximum_windows=20_000 - usable_windows))
        files.append({'path': str(source), 'sha256': digest})
    require(usable_windows > 0, 'No usable pilot windows: collect a continuous 3.2-second segment with valid actual future targets.')
    manifest = {'schema_version': 'mediapipe-lstm-manifest-v1', 'poseModelId': expected_model,
                'participants': {'train': sorted(participants), 'validation': [], 'test': []}, 'files': files}
    if explicit_synthetic:
        manifest['explicitSynthetic'] = True
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8') as stream:
        json.dump(manifest, stream, indent=2, allow_nan=False)
    return {'manifest': str(output), 'mode': 'pilot', 'files': len(files), 'participants': 1, 'usable_windows': usable_windows}
