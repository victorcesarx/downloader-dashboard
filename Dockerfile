# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run verify

FROM node:24-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="WebScope" \
      org.opencontainers.image.description="Media extraction and download dashboard" \
      org.opencontainers.image.source="https://github.com/victorcesarx/downloader-dashboard"

ENV NODE_ENV=production \
    PORT=3006 \
    TEMP_DIR=/app/temp_zips

WORKDIR /app

COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/package.json /app/package-lock.json ./
COPY --chown=node:node --from=build /app/server.js ./server.js
COPY --chown=node:node --from=build /app/server ./server
COPY --chown=node:node --from=build /app/dist ./dist

RUN mkdir -p /app/temp_zips && chown node:node /app/temp_zips

USER node:node
EXPOSE 3006
VOLUME ["/app/temp_zips"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3006)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "server/production.js"]
