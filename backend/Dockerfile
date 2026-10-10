FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

# src/tsx kept alongside the compiled dist/ so the manual, network-free
# `npm run reclassify-diet` / `npm run ingest` CLI workflows still work via
# `docker exec` — only the main server process (CMD) runs from dist.
COPY src ./src
COPY --from=builder /app/dist ./dist
# The v1 API guide, served by GET /api/v1/info.
COPY docs ./docs

EXPOSE 4000

CMD ["node", "dist/server.js"]
