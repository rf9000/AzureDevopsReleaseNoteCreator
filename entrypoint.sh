#!/bin/bash
set -e

if [ "$(id -u)" = "0" ]; then
  # Bind-mounted volumes retain host uid/gid — fix ownership
  chown -R claude:claude /app/.state
  chown -R claude:claude /home/claude/.claude 2>/dev/null || true

  # su without login shell doesn't set HOME — pass it explicitly
  exec su claude -c "export HOME=/home/claude && cd /app && bun run start"
fi

exec bun run start
