FROM node:26-alpine AS build

RUN npm install --global corepack@0.35.0 \
    && corepack enable
WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/package.json
RUN pnpm install --frozen-lockfile

COPY frontend frontend
RUN pnpm --filter @zerp/frontend build

FROM nginx:1.29-alpine

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/frontend/dist /usr/share/nginx/html

EXPOSE 8080
