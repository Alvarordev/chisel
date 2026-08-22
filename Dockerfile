FROM oven/bun:1.3.14 AS build

WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN bun install --frozen-lockfile

COPY apps ./apps
COPY packages ./packages
RUN bun run build:web

FROM oven/bun:1.3.14 AS runtime

WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN bun install --frozen-lockfile --production

COPY apps/api/src ./apps/api/src
COPY packages/contracts/src ./packages/contracts/src
COPY --from=build /app/apps/web/dist ./apps/web/dist

ENV DATA_DIR=/data
ENV HOST=0.0.0.0
ENV PORT=3000
VOLUME ["/data"]
EXPOSE 3000

CMD ["bun", "apps/api/src/index.ts"]
