FROM node:20-alpine AS base

WORKDIR /app

COPY package.json ./
RUN npm install
COPY . .

# ---- dev: used by docker-compose.yml; src/index.html get overridden by
# bind mounts at runtime, everything else (config, deps) comes from here.
FROM base AS dev
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]

# ---- build: compiles static assets
FROM base AS build
# Left unset -> API_URL resolves to "" in api.ts, i.e. relative /api/*
# requests, which nginx.conf proxies to the backend container. That avoids
# needing to know the server's public hostname at image-build time.
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ---- prod (default target): nginx serving the compiled static assets
FROM nginx:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
