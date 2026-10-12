# --- Build stage ---
FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/auth-config/package.json packages/auth-config/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci

COPY tsconfig.json tsconfig.base.json ./
COPY packages/auth-config/ packages/auth-config/
COPY packages/server/ packages/server/
COPY packages/client/ packages/client/
RUN npm run build:image

# --- Production stage ---
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/auth-config/package.json packages/auth-config/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --omit=dev

COPY --from=build /app/packages/auth-config/dist packages/auth-config/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist
# The sample library the public demo seeds each guest with (QB_DEMO=1); unused otherwise.
COPY packages/server/demo packages/server/demo

EXPOSE 3001
VOLUME /data
ENV QB_DATA_DIR=/data
ENV QB_ALLOW_DEFAULT_CUSTOMER=1

CMD ["node", "packages/server/dist/index.js"]
