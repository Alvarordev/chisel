FROM oven/bun:1.3.14 AS runtime

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY tsconfig.json ./tsconfig.json

ENV DATA_DIR=/data
ENV HOST=0.0.0.0
ENV PORT=3000
VOLUME ["/data"]
EXPOSE 3000

CMD ["bun", "src/index.ts"]
