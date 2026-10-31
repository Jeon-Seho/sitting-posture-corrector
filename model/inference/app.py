"""FastAPI composition root for stateless development inference."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from .internal_auth import InternalTokenMiddleware, configured_token
from .kafka_worker import worker
from .routes import router
from .schemas import Features, InferenceRequest  # Keep existing import paths available.


async def invalid_request(request: Request, error: RequestValidationError):
    # Do not reflect feature values (including NaN) in errors.
    return JSONResponse(status_code=422, content={"error": "invalid_contract"})


@asynccontextmanager
async def lifespan(application: FastAPI):
    # Kafka inference v3 runs beside HTTP only when POSEGOOD_KAFKA_BOOTSTRAP_SERVERS is set (plan 0064).
    worker.start()
    yield
    worker.stop()


def create_app() -> FastAPI:
    application = FastAPI(title="PoseGood development inference", version="0.1.0", lifespan=lifespan)
    application.add_middleware(InternalTokenMiddleware, token=configured_token())
    application.add_exception_handler(RequestValidationError, invalid_request)
    application.include_router(router)
    return application


# Uvicorn and existing contract tests use model.inference.app:app.
app = create_app()
