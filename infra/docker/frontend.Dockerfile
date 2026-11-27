FROM node:24-bookworm-slim AS build
WORKDIR /source/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
COPY model/prototype /source/model/prototype
COPY contracts /source/contracts
ARG VITE_SERVER_ACCOUNTS=true
ENV VITE_SERVER_ACCOUNTS=${VITE_SERVER_ACCOUNTS}
# (D-107) 메일 기능 화면 스위치 — 빌드할 때 굳는다(.dockerignore가 .env*를 빼므로 build args로만). 기본은 꺼짐.
# 서버 compose(bigdata.yaml web)는 서버 .env의 POSEGOOD_PASSWORD_RESET_ENABLED·POSEGOOD_EMAIL_VERIFICATION_ENABLED를 넘긴다
ARG VITE_PASSWORD_RESET_ENABLED=false
ARG VITE_EMAIL_VERIFICATION_ENABLED=false
ENV VITE_PASSWORD_RESET_ENABLED=${VITE_PASSWORD_RESET_ENABLED} \
    VITE_EMAIL_VERIFICATION_ENABLED=${VITE_EMAIL_VERIFICATION_ENABLED}
RUN npm run build

FROM nginx:1.30-alpine
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /source/frontend/dist /usr/share/nginx/html
EXPOSE 80
