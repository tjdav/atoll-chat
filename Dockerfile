# Stage 1: Build Coralite Frontend
FROM node:24-alpine AS builder

# Set CI=true to prevent interactive prompts
ENV CI=true

# Expose build-time arguments for the frontend (with defaults)
ARG DATABASE_URL="/"
ARG VAPID_KEY="BI42LscA_XvC28RpxgGk_g0-XW5yC4S_N924_68yL4Zpx8aX_P1_x2_58yL4Zpx8aX_P1_x2_58yL4Zpx8aX_P1_x2"
ARG IOS_TEAM_ID="TEAMID1234"
ARG IOS_APP_ID="com.atoll.chat"
ARG ANDROID_PACKAGE_NAME="com.atoll.chat"
ARG ANDROID_CERT_FINGERPRINT="FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C"

# Map build arguments to environment variables so the build process can access them
ENV DATABASE_URL=${DATABASE_URL}
ENV VAPID_KEY=${VAPID_KEY}
ENV IOS_TEAM_ID=${IOS_TEAM_ID}
ENV IOS_APP_ID=${IOS_APP_ID}
ENV ANDROID_PACKAGE_NAME=${ANDROID_PACKAGE_NAME}
ENV ANDROID_CERT_FINGERPRINT=${ANDROID_CERT_FINGERPRINT}

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

# Expose run-time environment variables for deployment
ENV PORT=8080
ENV TURN_SHARED_SECRET="REPLACE_THIS_WITH_A_LONG_RANDOM_STRING"
ENV TURN_EXPIRES_IN_SECONDS=3600
ENV ALLOWED_ORIGINS="*"

# OPTIONAL: Native PocketBase auto-provisioning admin credentials on startup
# ENV PB_ADMIN_EMAIL="admin@example.com"
# ENV PB_ADMIN_PASSWORD="ChooseAStrongPassword123"

# Set working directory for PocketBase
WORKDIR /pb

# Copy the compiled frontend from builder stage
COPY --from=builder /app/dist ./pb_public

# Copy hooks and migrations
COPY ./database/pb_hooks ./pb_hooks
COPY ./database/pb_migrations ./pb_migrations

# Expose the PocketBase port (defaults to 8080 but dynamic)
EXPOSE 8080

# Start PocketBase with dynamic port binding and CORS configuration
ENTRYPOINT ["sh", "-c", "/usr/local/bin/pocketbase serve --http=0.0.0.0:${PORT} --dir=/pb/pb_data --publicDir=/pb/pb_public --hooksDir=/pb/pb_hooks --migrationsDir=/pb/pb_migrations --cors=\"${ALLOWED_ORIGINS}\""]