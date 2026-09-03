FROM node:26-alpine

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/model/package.json packages/model/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN npm install --global pnpm@10.34.5 && pnpm install --frozen-lockfile --filter @zerp/api...

COPY apps/api apps/api
COPY packages/model packages/model

WORKDIR /workspace/apps/api
EXPOSE 8080
CMD ["node", "src/server.ts"]
