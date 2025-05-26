# syntax = docker/dockerfile:1

# Base con Node.js
ARG NODE_VERSION=20.18.0
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Node.js"
WORKDIR /app
ENV NODE_ENV="production"

# Instalar librerías necesarias para ejecutar Chromium en Playwright
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
        libglib2.0-0 \
        libnss3 \
        libatk-bridge2.0-0 \
        libx11-xcb1 \
        libdrm2 \
        libxcomposite1 \
        libxdamage1 \
        libxrandr2 \
        libgbm1 \
        libasound2 \
        libatk1.0-0 \
        libcups2 \
        libgtk-3-0 \
        libxshmfence1 \
        libxfixes3 \
        libxext6 \
        fonts-liberation \
        xdg-utils \
        ca-certificates \
        wget \
        curl && \
    rm -rf /var/lib/apt/lists/*

# ----------------------
# Etapa de build
# ----------------------
FROM base AS build

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
        build-essential \
        node-gyp \
        pkg-config \
        python-is-python3

COPY package-lock.json package.json ./
RUN npm ci

# Instala Chromium y otras dependencias de Playwright
RUN npx playwright install --with-deps

COPY . .

# ----------------------
# Etapa final
# ----------------------
FROM base

# Copiar app y navegadores desde build
COPY --from=build /app /app
COPY --from=build /root/.cache /root/.cache

# Volumen para SQLite (opcional en Turso)
RUN mkdir -p /data
VOLUME /data

EXPOSE 3000
ENV DATABASE_URL="file:///data/sqlite.db"

CMD ["npm", "run", "start"]
