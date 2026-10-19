FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=2284 FOLIO_DATA=/data
RUN apk add --no-cache su-exec
COPY package.json ./
COPY src ./src
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/folio-entrypoint
RUN chmod +x /usr/local/bin/folio-entrypoint && mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 2284
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:2284/_folio/api/meta >/dev/null || exit 1
# Starts as root only long enough to fix /data ownership, then runs as "node".
ENTRYPOINT ["folio-entrypoint"]
CMD ["node", "src/server.js"]
