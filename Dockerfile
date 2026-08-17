# Node 20 went end of life on 2026-04-30 and stopped getting security fixes,
# which is where most base-image CVEs come from. 25 is current.
FROM node:25-alpine

WORKDIR /app

# Copy the lockfile too and use `npm ci`, so image builds are reproducible and
# match the committed dependency tree exactly.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public

# Data volume for persistence. Owned by the built-in `node` user (uid 1000) so
# the container never has to run as root to write nights.
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

ENV PORT=8430
ENV DATA_DIR=/app/data

EXPOSE 8430

USER node

CMD ["node", "server.js"]
