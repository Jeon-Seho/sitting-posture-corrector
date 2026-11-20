FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# Uvicorn worker processes; each loads the model once. Compose overrides with POSEGOOD_INFERENCE_WORKERS.
ENV WEB_CONCURRENCY=2
WORKDIR /app
COPY requirements-dev.txt ./requirements-dev.txt
COPY model/inference/requirements.txt ./requirements-inference.txt
# Exclude research requirements and install the RF runtime pins separately.
RUN grep -v '^-r ' requirements-dev.txt > requirements-runtime.txt \
    && pip install --no-cache-dir -r requirements-runtime.txt -r requirements-inference.txt \
    && groupadd --gid 10001 posegood \
    && useradd --uid 10001 --gid posegood --no-create-home posegood
COPY model/inference ./model/inference
COPY model/pretrained/frame-rf-100x/frame-corrector.joblib model/pretrained/frame-rf-100x/frame-posture.joblib ./model/pretrained/frame-rf-100x/
USER posegood
EXPOSE 8092
CMD ["python", "-m", "uvicorn", "model.inference.app:app", "--host", "0.0.0.0", "--port", "8092", "--no-access-log"]
