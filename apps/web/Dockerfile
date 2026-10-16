# Build from the repository root, not apps/web.
FROM node:22.22.3-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM dependencies AS build
COPY . .
# "/" resolves Socket.IO against the browser's origin (HTTP or HTTPS).
# A domain change therefore does not require rebuilding the client.
ENV NEXT_PUBLIC_SOCKET_URL="/" \
    NEXT_OUTPUT_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS="--max-old-space-size=2048"
RUN npm run build -w @sync/shared && npm run build -w web

FROM node:22.22.3-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
