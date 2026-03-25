FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
    fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --production

RUN npx playwright install chromium --with-deps

COPY prisma ./prisma/
RUN npx prisma generate

COPY . .

ENV PORT=5177
ENV NODE_ENV=production
ENV DEMO_MODE=false

EXPOSE 5177

CMD npx prisma migrate deploy || echo "Migration skipped (no DB)" ; node scripts/serve-editor.js
