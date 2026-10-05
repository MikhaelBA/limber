# ---- Stage 1: build ---------------------------------------------------------
# Builds @sprine/core + @sprine/runtime (tsc project references) and the
# @sprine/editor production bundle (Vite).
FROM node:22-alpine AS build
WORKDIR /app

# Dependency layer first for cache efficiency (workspace manifests only).
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/runtime/package.json packages/runtime/
COPY packages/editor/package.json packages/editor/
RUN npm ci

# Sources + toolchain configs.
COPY tsconfig.json tsconfig.base.json vitest.config.ts ./
COPY packages/core packages/core
COPY packages/runtime packages/runtime
COPY packages/editor packages/editor

RUN npm run build \
 && npm run build -w @sprine/editor

# ---- Stage 2: serve ---------------------------------------------------------
# Static SPA — no Node at runtime.
FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/editor/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
