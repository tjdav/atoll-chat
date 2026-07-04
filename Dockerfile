# Stage 1: Build Coralite Frontend
FROM node:24-alpine AS builder

# Set CI=true to prevent interactive prompts
ENV CI=true

# Set working directory
WORKDIR /app

# Enable corepack
RUN corepack enable pnpm

# Cache dependency downloads based ONLY on the lockfile
COPY pnpm-lock.yaml ./
RUN pnpm fetch

#  Copy the entire source code
COPY . .

# 3. Install dependencies offline (instant, uses the fetched cache)
RUN pnpm install --frozen-lockfile --offline

# Build the frontend
RUN pnpm run build

# Stage 2: Final Image
FROM alpine:latest

# Set PocketBase version
ARG PB_VERSION=0.39.5

# Combine apk add and wget/unzip into a single RUN to reduce image layers
RUN apk add --no-cache ca-certificates unzip wget libc6-compat \
    && wget https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip \
    && unzip pocketbase_${PB_VERSION}_linux_amd64.zip -d /usr/local/bin/ \
    && rm pocketbase_${PB_VERSION}_linux_amd64.zip \
    && chmod +x /usr/local/bin/pocketbase

# Set working directory for PocketBase
WORKDIR /pb

# Copy the compiled frontend from builder stage
COPY --from=builder /app/dist ./pb_public

# Copy hooks and migrations
COPY ./database/pb_hooks ./pb_hooks
COPY ./database/pb_migrations ./pb_migrations

# Expose the PocketBase port
EXPOSE 8080

# Start PocketBase
ENTRYPOINT ["/usr/local/bin/pocketbase", "serve", "--http=0.0.0.0:8080", "--dir=/pb/pb_data", "--publicDir=/pb/pb_public", "--hooksDir=/pb/pb_hooks", "--migrationsDir=/pb/pb_migrations"]