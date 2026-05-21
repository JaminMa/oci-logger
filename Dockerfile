# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:26-alpine AS builder

WORKDIR /app

# Copy manifests first to leverage layer caching
COPY package.json package-lock.json ./

# Install all deps (including devDependencies needed for tsc)
RUN npm ci

# Copy source and compiler config, then compile
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ─── Stage 2: Runner ─────────────────────────────────────────────────────────
FROM node:26-alpine AS runner

# Run as non-root for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy manifests and install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Ownership for non-root user
RUN chown -R appuser:appgroup /app

USER appuser

# Expose the default port (override with PORT env var)
EXPOSE 3000

# Health check against the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/health || exit 1

CMD ["node", "dist/index.js"]
