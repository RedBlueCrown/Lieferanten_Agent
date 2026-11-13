# One image for the API and the built web app (Azure Container Apps).
# The API serves the web app from WEB_DIST_DIR. The daily Container Apps Job
# runs the same image with: node apps/api/dist/jobs/daily.mjs
#
# Plain Dockerfile syntax (no BuildKit-only features) so that it also builds
# remotely in Azure Container Registry ("azd deploy" with remoteBuild).

ARG NODE_IMAGE=node:22-slim

# ---------------------------------------------------------------------------
# Build: all dependencies, then bundle the API (esbuild) and the web app (Vite)
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV CI=true \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Manifests first, so the dependency layer is cached until they change.
# Add new workspaces here as well.
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
# migrations/ and seed-assets/ are optional: make sure they exist so the COPY
# steps of the runtime stage never fail.
RUN npm run build -w @vm/api \
 && npm run build -w @vm/web \
 && mkdir -p apps/api/migrations apps/api/seed-assets

# ---------------------------------------------------------------------------
# Runtime: production dependencies of the API only, non-root user
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_DIR=/app/apps/web/dist \
    DATA_DIR=/tmp/data \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# npm packages stay external in the esbuild bundle, so the API's production
# dependencies must be installed (hoisted to /app/node_modules, plus any
# nested apps/api/node_modules). Dev dependencies and the web app's
# dependencies are left out.
RUN npm ci --omit=dev --workspace @vm/api --include-workspace-root=false \
 && npm cache clean --force

# @vm/domain is bundled into dist by apps/api/build.mjs.
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
COPY --from=build /app/apps/api/seed-assets ./apps/api/seed-assets
COPY --from=build /app/apps/web/dist ./apps/web/dist

# Files stay owned by root (read-only for the app); only /tmp is writable.
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/server.mjs"]
