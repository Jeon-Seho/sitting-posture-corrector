"""FastAPI composition root for stateless inference."""

from contextlib import asynccontextmanager
import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .frame_model import DEFAULT_MODEL_DIR, RF_MODEL, FrameRandomForest, load_frame_model
from .internal_auth import InternalTokenMiddleware, configured_token
from .routes import router
from .service import FrameInference


logger = logging.getLogger(__name__)


async def invalid_request(request: Request, error: RequestValidationError):
    # Do not reflect feature values (including NaN) in errors.
    return JSONResponse(status_code=422, content={"error": "invalid_contract"})


def create_app(frame_model: Optional[FrameRandomForest] = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        mode = os.environ.get("POSEGOOD_INFERENCE_MODEL", RF_MODEL)
        if mode == "rule":
            application.state.frame_inference = FrameInference()
        elif mode == RF_MODEL:
            try:
                directory = Path(os.environ.get("POSEGOOD_MODEL_DIR", str(DEFAULT_MODEL_DIR)))
                rf = frame_model if frame_model is not None else load_frame_model(directory)
                application.state.frame_inference = FrameInference(rf)
            except Exception:
                logger.error("Frame RF model could not be loaded")
        else:
            logger.error("Invalid inference model configuration")
        try:
            yield
        finally:
            application.state.frame_inference = None

    application = FastAPI(title="PoseGood development inference", version="0.1.0", lifespan=lifespan)
    application.state.frame_inference = None
    application.add_middleware(InternalTokenMiddleware, token=configured_token())
    application.add_exception_handler(RequestValidationError, invalid_request)
    application.include_router(router)
    return application


# Uvicorn and existing contract tests use model.inference.app:app.
app = create_app()
