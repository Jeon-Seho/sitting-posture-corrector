"""HTTP routes translate requests into stateless inference calls."""

from fastapi import APIRouter

from .schemas import InferenceRequestV2
from .service import MODEL_VERSION, predict_feature_observation


router = APIRouter()


@router.get("/health")
def health():
    return {"status": "ok", "model_version": MODEL_VERSION, "learned": False}


@router.post("/infer")
def infer_features(request: InferenceRequestV2):
    return predict_feature_observation(request)
