FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements-dev.txt ./requirements-dev.txt
RUN pip install --no-cache-dir -r requirements-dev.txt \
    && groupadd --gid 10001 posegood \
    && useradd --uid 10001 --gid posegood --no-create-home posegood
COPY model/inference ./model/inference
USER posegood
EXPOSE 8092
CMD ["python", "-m", "uvicorn", "model.inference.app:app", "--host", "0.0.0.0", "--port", "8092", "--no-access-log"]
