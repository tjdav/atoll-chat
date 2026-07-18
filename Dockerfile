# Stage 1: Build Coralite Frontend
FROM node:24-alpine AS builder

# Set CI=true to prevent interactive prompts
ENV CI=true

# Expose build-time arguments for the frontend (with defaults)
ARG ATOLL_POCKETBASE_URL="/"
ARG ATOLL_VAPID_PUBLIC_KEY="BI42LscA_XvC28RpxgGk_g0-XW5yC4S_N924_68yL4Zpx8aX_P1_x2_58yL4Zpx8aX_P1_x2_58yL4Zpx8aX_P1_x2"
ARG ATOLL_IOS_TEAM_ID="TEAMID1234"
ARG ATOLL_IOS_APP_ID="com.atoll.chat"
ARG ATOLL_ANDROID_PACKAGE_NAME="com.atoll.chat"
ARG ATOLL_ANDROID_CERT_FINGERPRINT="FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C"

# Map build arguments to environment variables so the build process can access them
ENV ATOLL_POCKETBASE_URL=${ATOLL_POCKETBASE_URL}
ENV ATOLL_VAPID_PUBLIC_KEY=${ATOLL_VAPID_PUBLIC_KEY}
ENV ATOLL_IOS_TEAM_ID=${ATOLL_IOS_TEAM_ID}
ENV ATOLL_IOS_APP_ID=${ATOLL_IOS_APP_ID}
ENV ATOLL_ANDROID_PACKAGE_NAME=${ATOLL_ANDROID_PACKAGE_NAME}
ENV ATOLL_ANDROID_CERT_FINGERPRINT=${ATOLL_ANDROID_CERT_FINGERPRINT}

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
ARG PB_VERSION=0.39.7

# Combine apk add and wget/unzip into a single RUN to reduce image layers
RUN apk add --no-cache ca-certificates unzip wget libc6-compat \
    && wget https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip \
    && unzip pocketbase_${PB_VERSION}_linux_amd64.zip -d /usr/local/bin/ \
    && rm pocketbase_${PB_VERSION}_linux_amd64.zip \
    && chmod +x /usr/local/bin/pocketbase

# Expose run-time environment variables for deployment
ENV PORT=8080
ENV ATOLL_TURN_SHARED_SECRET="REPLACE_THIS_WITH_A_LONG_RANDOM_STRING"
ENV ATOLL_TURN_EXPIRES_IN_SECONDS=3600
ENV ATOLL_ALLOWED_ORIGINS="*"

# S3 Configuration
ENV ATOLL_S3_ENDPOINT=""
ENV ATOLL_S3_BUCKET=""
ENV ATOLL_S3_ACCESS_KEY=""
ENV ATOLL_S3_SECRET_KEY=""
ENV ATOLL_S3_REGION="us-east-1"
ENV ATOLL_S3_FORCE_PATH_STYLE="false"

# SMTP Configuration
ENV ATOLL_SMTP_HOST=""
ENV ATOLL_SMTP_PORT="587"
ENV ATOLL_SMTP_USERNAME=""
ENV ATOLL_SMTP_PASSWORD=""
ENV ATOLL_SMTP_SENDER_NAME="Atoll Chat"
ENV ATOLL_SMTP_SENDER_ADDRESS="noreply@atoll.chat"

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

# Start PocketBase with dynamic port binding and CORS configuration using origins flag
ENTRYPOINT ["sh", "-c", "/usr/local/bin/pocketbase serve --http=0.0.0.0:${PORT} --dir=/pb/pb_data --publicDir=/pb/pb_public --hooksDir=/pb/pb_hooks --migrationsDir=/pb/pb_migrations --origins=\"${ATOLL_ALLOWED_ORIGINS}\""]