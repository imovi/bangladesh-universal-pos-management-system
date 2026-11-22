# Build stage
FROM node:24-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install build dependencies
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/api/package*.json ./apps/api/
RUN npm ci

# Copy source and build packages/shared and apps/api
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN npm --workspace=@universal-pos/shared run build
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
RUN npm --workspace=@universal-pos/api run build

# Migration stage (one-shot migration runner)
FROM node:24-bookworm-slim AS migrator
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/api/package*.json ./apps/api/
RUN npm ci

COPY apps/api/prisma ./apps/api/prisma

USER node

CMD ["npx", "prisma", "migrate", "deploy", "--schema=apps/api/prisma/schema.prisma"]

# Runtime stage
FROM node:24-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=4000

# Install production dependencies only
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/api/package*.json ./apps/api/
RUN npm ci --omit=dev

# Copy generated Prisma client from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma

# Copy built code
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Use non-root node user provided by official Node image
USER node

EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 4000) + '/api/v1/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "apps/api/dist/main.js"]
