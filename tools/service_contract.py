"""Offline validation for versioned service contracts; never resolves remote URLs."""
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]


def validator(filename):
    schema = json.loads((ROOT / 'contracts' / filename).read_text(encoding='utf-8'))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


OBSERVATION = validator('posture-observation.v2.schema.json')
VIEW = validator('session-view.v1.schema.json')
EVENT = validator('posture-event.v1.schema.json')
INFERENCE_REQUEST_V2 = validator('inference-request.v2.schema.json')
FEATURE_RESPONSE = validator('feature-response.v1.schema.json')


def validate_observation(value):
    # JSON Schema alone cannot enforce cross-field interval ordering.
    json.dumps(value, allow_nan=False)
    OBSERVATION.validate(value)
    if not 0 < value['end_ms'] - value['start_ms'] <= 1500:
        raise ValueError('interval must be 1..1500ms')


def validate_view(value):
    json.dumps(value, allow_nan=False)
    VIEW.validate(value)
    for event in value['events']:
        EVENT.validate(event)
        if event['session_id'] != value['session_id']:
            raise ValueError('event session mismatch')


def validate_inference_request_v2(value):
    json.dumps(value, allow_nan=False)
    INFERENCE_REQUEST_V2.validate(value)
    if not 0 < value['end_ms'] - value['start_ms'] <= 1500:
        raise ValueError('interval must be 1..1500ms')


def validate_feature_response(value, inference_request=None):
    json.dumps(value, allow_nan=False)
    FEATURE_RESPONSE.validate(value)
    observation, session = value['observation'], value['session']
    validate_observation(observation)
    validate_view(session)
    if session['last_sequence'] < observation['sequence']:
        raise ValueError('session has not accepted the observation')
    if session['summary']['total_ms'] < observation['end_ms']:
        raise ValueError('session has not accounted for the observation interval')
    if inference_request is not None:
        for field in ('sequence', 'start_ms', 'end_ms', 'phase'):
            if observation[field] != inference_request[field]:
                raise ValueError('inference request/response mismatch')
