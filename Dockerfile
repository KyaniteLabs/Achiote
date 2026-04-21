FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/src/data ./src/data
RUN npm ci --omit=dev && npm cache clean --force
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/http-server.js"]
