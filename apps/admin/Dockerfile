# Build stage
FROM node:24-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install build dependencies
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/admin/package*.json ./apps/admin/
RUN npm ci

# Copy source and build packages/shared and apps/admin
COPY packages/shared ./packages/shared
RUN npm --workspace=@universal-pos/shared run build

COPY apps/admin ./apps/admin
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_API_URL=https://localhost/api/v1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npm --workspace=@universal-pos/admin run build

# Runtime stage
FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

# Copy standalone build output
COPY --from=builder /app/apps/admin/.next/standalone ./
COPY --from=builder /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=builder /app/apps/admin/public ./apps/admin/public

# Use non-root node user provided by official Node image
USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "apps/admin/server.js"]
