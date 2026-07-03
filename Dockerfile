# Stage 1: Build Coralite Frontend
FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy the rest of the application
COPY . .

# Build the frontend
RUN pnpm run build

# Stage 2: Final Image
FROM alpine:3.20

# Set PocketBase version
ARG PB_VERSION=0.39.4

# Install dependencies for PocketBase
RUN apk add --no-cache \
    ca-certificates \
    unzip \
    wget \
    libc6-compat

# Download and install PocketBase
RUN wget https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip \
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
