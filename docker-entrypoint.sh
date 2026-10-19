#!/bin/sh
# Docker creates bind-mounted folders (./folio-data) owned by root. When we start
# as root, hand the data folder to the unprivileged "node" user, then drop to it.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$FOLIO_DATA"
  chown -R node:node "$FOLIO_DATA"
  exec su-exec node "$@"
fi
exec "$@"
