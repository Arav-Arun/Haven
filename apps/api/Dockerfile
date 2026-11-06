# Haven API. Build from the repo root:
#   fly deploy --config apps/api/fly.toml --dockerfile apps/api/Dockerfile .
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@haven/api..."
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["pnpm", "--filter", "@haven/api", "start"]
