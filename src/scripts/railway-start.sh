#!/bin/sh
set -eu

if [ -n "${RAILWAY_VOLUME_MOUNT_PATH:-}" ]; then
  APP_DATA_DIR="$RAILWAY_VOLUME_MOUNT_PATH"
  export APP_DATA_DIR
  if [ -f "$APP_DATA_DIR/bereg-migration.tar.gz" ]; then
    tar -xzf "$APP_DATA_DIR/bereg-migration.tar.gz" -C "$APP_DATA_DIR"
    rm -f "$APP_DATA_DIR/bereg-migration.tar.gz"
  fi
fi

exec node server.js
