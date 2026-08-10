# Render Background Worker image for the WhatsApp group bridge.
# whatsapp-web.js drives a headless Chromium via Puppeteer, so we install the
# OS Chromium + its runtime libs and point Puppeteer at it (no bundled download).
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates fonts-liberation \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 libgtk-3-0 \
  && rm -rf /var/lib/apt/lists/*

# Puppeteer: use the system Chromium, skip its own download.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# Install deps first for layer caching.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY bridge.js ./

# Session persists on a mounted disk at /data (set SESSION_DIR=/data/.wwebjs_auth).
CMD ["node", "bridge.js"]
