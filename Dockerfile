# syntax = docker/dockerfile:1

# Ajustar la versión de Node si se desea
ARG NODE_VERSION=20.18.0
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Node.js"

# Directorio de trabajo
WORKDIR /app

# Entorno de producción
ENV NODE_ENV="production"

# -------------------------
# Etapa de construcción
# -------------------------
FROM base AS build

# Instalar dependencias necesarias para compilar y ejecutar Playwright
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
        build-essential \
        node-gyp \
        pkg-config \
        python-is-python3 \
        wget \
        gnupg \
        curl \
        ca-certificates \
        fonts-liberation \
        libappindicator3-1 \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcups2 \
        libdbus-1-3 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libx11-xcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxrandr2 \
        xdg-utils \
        && rm -rf /var/lib/apt/lists/*

# Instalar dependencias Node.js
COPY package-lock.json package.json ./
RUN npm ci

# Instalar navegadores de Playwright
RUN npx playwright install --with-deps

# Copiar el código fuente
COPY . .

# -------------------------
# Etapa final
# -------------------------
FROM base

# Copiar la app desde la etapa build
COPY --from=build /app /app

# También es necesario copiar la caché de los navegadores instalados
COPY --from=build /root/.cache /root/.cache

# Directorio para la base de datos (si usas sqlite)
RUN mkdir -p /data
VOLUME /data

# Puerto expuesto
EXPOSE 3000

# Variable de entorno para Turso (por si acaso también usas esto)
ENV DATABASE_URL="file:///data/sqlite.db"

# Comando de inicio
CMD ["npm", "run", "start"]
