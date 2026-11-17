FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/index.html frontend/vite.config.js ./
COPY frontend/src ./src
# Public generic anatomy only, pinned and verified; no patient data is downloaded.
RUN apk add --no-cache curl && mkdir -p public/atlas && \
    cp -r node_modules/three/examples/jsm/libs/draco public/atlas/draco && \
    curl --fail --location --retry 3 --silent --show-error \
      https://cdn.jsdelivr.net/gh/itayinbarr/brainproject@2929e94f521a8ddceab26bc100a98dc06b0da060/brain-atlas/models/brain.glb \
      -o public/atlas/brain.glb && \
    echo '76a49ea4526a4880613aec7a02756bd7301b0b9d0680d7cae33e197b672c5453  public/atlas/brain.glb' | sha256sum -c -
RUN npm run build

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng poppler-utils \
  && rm -rf /var/lib/apt/lists/*
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/app/data STATIC_DIR=/app/static
WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY --from=web /web/dist ./static
RUN groupadd -g 10001 rmstudio && useradd --uid 10001 --gid 10001 --no-create-home rmstudio \
  && mkdir -p /app/data && chown -R 10001:10001 /app/data
USER 10001:10001
EXPOSE 8000
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000"]
