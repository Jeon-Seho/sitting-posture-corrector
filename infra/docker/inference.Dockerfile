FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements-dev.txt ./requirements-dev.txt
# requirements-dev.txt의 `-r model/analysis/...`(연구·학습용 numpy·scikit-learn·torch)는 추론 서버에 필요 없고
# 이 이미지에는 그 파일이 없다 — 그 줄만 빼고 설치한다(2026-11-10, D-84).
RUN grep -v '^-r ' requirements-dev.txt > requirements-runtime.txt \
    && pip install --no-cache-dir -r requirements-runtime.txt \
    && groupadd --gid 10001 posegood \
    && useradd --uid 10001 --gid posegood --no-create-home posegood
COPY model/inference ./model/inference
USER posegood
EXPOSE 8092
CMD ["python", "-m", "uvicorn", "model.inference.app:app", "--host", "0.0.0.0", "--port", "8092", "--no-access-log"]
