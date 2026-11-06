# The API image: one bundled file on Node 22, run as the unprivileged `node` user.
# Build the bundle first (`pnpm --filter @cloakroom/api build`); `pnpm --filter @cloakroom/api deploy` does both.
# The build context is apps/api only, and .dockerignore admits nothing but dist/, so no .env file can reach the
# builder or the image. Configuration comes from Fly secrets at runtime.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY dist/server.mjs ./server.mjs
USER node
EXPOSE 8787
CMD ["node", "server.mjs"]
