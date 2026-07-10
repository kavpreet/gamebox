# GameBox — single app image: backend + built frontend served together.
# Build from the repo root:  docker build -f infra/Dockerfile -t gamebox .
# (bookworm-slim, not alpine: better-sqlite3/pg native prebuilds target glibc,
#  and arm64 builds for the Pi work out of the box)
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN npm ci
RUN npm run build -w apps/frontend

# Runtime keeps the workspace (backend runs from TS via tsx) but drops dev deps.
RUN npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app /app

ENV NODE_ENV=production
ENV PORT=3001
ENV FRONTEND_DIST=/app/apps/frontend/dist

EXPOSE 3001
CMD ["npx", "tsx", "apps/backend/src/index.ts"]
