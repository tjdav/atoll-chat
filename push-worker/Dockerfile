FROM node:24-alpine

WORKDIR /app

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml* ./

RUN pnpm install --prod

COPY index.js ./

EXPOSE 3000

CMD ["node", "index.js"]
