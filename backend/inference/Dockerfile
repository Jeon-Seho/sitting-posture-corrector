# 빌드 위치는 저장소 루트다(infra/compose/bigdata.yaml: context ../.., dockerfile backend/inference/Dockerfile).
# (계획 0098) HTTP /infer와 같은 특징 계산·프레임 RF 코드(model/inference)와 가중치를 함께 넣는다.
FROM python:3.11-slim

WORKDIR /app

COPY backend/inference/requirements.txt .
# (D-63) torch(시험 LSTM)를 지워 PyTorch CPU wheel 저장소도 쓰지 않는다.
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/inference/app ./app
COPY model/inference ./model/inference
COPY model/pretrained/frame-rf-100x/frame-corrector.joblib model/pretrained/frame-rf-100x/frame-posture.joblib ./model/pretrained/frame-rf-100x/

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
