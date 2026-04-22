FROM node:20-bookworm AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY dashboard/package.json dashboard/package.json
COPY native/keyboard-hook/package.json native/keyboard-hook/package.json

RUN npm ci

COPY backend backend
COPY dashboard dashboard

RUN npm --workspace dashboard run build


FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV BACKEND_PORT=8787

# Runtime language executors for exam code.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 rustc cargo ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY dashboard/package.json dashboard/package.json
COPY native/keyboard-hook/package.json native/keyboard-hook/package.json

RUN npm ci --omit=dev --workspace backend --include-workspace-root=false

COPY backend backend
COPY --from=build /app/dashboard/dist dashboard/dist
COPY .env.example .env.example

EXPOSE 8787

CMD ["node", "backend/src/server.js"]

