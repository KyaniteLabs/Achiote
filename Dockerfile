FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM debian:bookworm-slim AS whisper
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates cmake curl g++ git make \
  && rm -rf /var/lib/apt/lists/*
RUN curl -L https://github.com/ggerganov/whisper.cpp/archive/refs/tags/v1.7.6.tar.gz -o /tmp/whisper.cpp.tar.gz \
  && mkdir -p /tmp/whisper.cpp \
  && tar -xzf /tmp/whisper.cpp.tar.gz -C /tmp/whisper.cpp --strip-components=1 \
  && cmake -S /tmp/whisper.cpp -B /tmp/whisper.cpp/build -DWHISPER_BUILD_TESTS=OFF \
  && cmake --build /tmp/whisper.cpp/build --config Release -j2 \
  && cp /tmp/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli

FROM node:22-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg libgomp1 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/docs ./docs
COPY --from=whisper /usr/local/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper /tmp/whisper.cpp/build/src/libwhisper.so* /usr/local/lib/
COPY --from=whisper /tmp/whisper.cpp/build/ggml/src/libggml*.so* /usr/local/lib/
RUN ldconfig
RUN npm ci --omit=dev && npm cache clean --force
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const port=process.env.PORT||'3000';fetch('http://127.0.0.1:'+port+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["node", "dist/http-server.js"]
