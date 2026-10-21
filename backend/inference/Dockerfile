FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
# (D-63) torch(시험 LSTM)를 지워 PyTorch CPU wheel 저장소도 쓰지 않는다.
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
