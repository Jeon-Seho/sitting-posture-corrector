FROM node:24-bookworm-slim AS build
WORKDIR /source/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
COPY model/prototype /source/model/prototype
COPY contracts /source/contracts
ARG VITE_SERVER_ACCOUNTS=true
ENV VITE_SERVER_ACCOUNTS=${VITE_SERVER_ACCOUNTS}
RUN npm run build

FROM nginx:1.30-alpine
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /source/frontend/dist /usr/share/nginx/html
EXPOSE 80
