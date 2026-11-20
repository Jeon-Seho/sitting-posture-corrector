"""HTTP routes translate requests into stateless inference calls."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .frame_model import PredictionError
from .schemas import InferenceRequest
from .service import InvalidBaseline


router = APIRouter()


@router.get("/health")
def health(request: Request):
    service = request.app.state.frame_inference
    if service is None:
        return JSONResponse(status_code=503, content={"status": "error"})
    return {"status": "ok", "model_version": service.model_version, "learned": service.rf is not None}


@router.post("/infer")
async def infer(body: InferenceRequest, request: Request):
    # The bounded, in-memory prediction is short enough to avoid a thread-pool hop.
    service = request.app.state.frame_inference
    if service is None:
        return JSONResponse(status_code=503, content={"status": "error"})
    try:
        return service.predict(body)
    except InvalidBaseline:
        return JSONResponse(status_code=422, content={"error": "invalid_contract"})
    except PredictionError:
        return JSONResponse(status_code=503, content={"status": "error"})
