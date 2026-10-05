"""HTTP routes translate requests into stateless inference calls."""

from fastapi import APIRouter

from .schemas import InferenceRequest, InferenceRequestV2
from .service import MODEL_VERSION, predict_feature_observation, predict_observation


router = APIRouter()


@router.get("/health")
def health():
    return {"status": "ok", "model_version": MODEL_VERSION, "learned": False}


@router.post("/v1/infer")
def infer(request: InferenceRequest):
    return predict_observation(request)


@router.post("/v2/infer")
def infer_features(request: InferenceRequestV2):
    return predict_feature_observation(request)
