FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=2284 FOLIO_DATA=/data
COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 2284
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:2284/_folio/api/meta >/dev/null || exit 1
CMD ["node", "src/server.js"]
