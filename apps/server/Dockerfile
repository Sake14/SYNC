# Build from the repository root, not apps/server.
FROM node:22.22.3-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run media:demo && npm run build -w @sync/shared && npm run build -w @sync/server

FROM node:22.22.3-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
# Install only the backend/shared runtime; Next.js and build tools stay outside.
RUN npm ci --omit=dev --workspace=@sync/server --workspace=@sync/shared --include-workspace-root=false \
    && mkdir -p apps/server/node_modules

FROM node:22.22.3-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/media ./media
# Docker initializes a fresh named volume with these node-owned permissions.
RUN mkdir -p /app/.data/uploads && chown -R node:node /app/.data
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
