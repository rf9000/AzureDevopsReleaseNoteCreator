FROM oven/bun:1

WORKDIR /app

# Install git, curl, bash (needed for Claude Code CLI install)
RUN apt-get update && apt-get install -y git curl bash && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Always ship the newest Claude Agent SDK; bun.lock only sets the floor. ADD of the
# registry's "latest" manifest invalidates the layer cache exactly when a new
# version is published, so a plain `docker compose build` picks it up.
ADD https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/latest /tmp/claude-agent-sdk-latest.json
RUN bun update @anthropic-ai/claude-agent-sdk --latest && \
    grep '"version"' node_modules/@anthropic-ai/claude-agent-sdk/package.json

COPY . .

# Claude Code Agent SDK uses --dangerously-skip-permissions which is blocked for root.
# Align claude to UID/GID 1000 so it matches the host user that owns the bind-mounted
# ~/.claude — otherwise the host (1000) and container clash over that shared dir (EACCES).
# The base oven/bun image already holds 1000 for its `bun` user, so renumber it out first.
RUN usermod -u 1100 bun && groupmod -g 1100 bun && \
    useradd -m -s /bin/bash -u 1000 -U claude && \
    chown -R claude:claude /app

# Install Claude Code CLI as non-root user (MUST use | bash, not | sh)
USER claude
RUN curl -fsSL https://claude.ai/install.sh | bash
USER root

# Claude Code installs to ~/.local/bin
ENV PATH="/home/claude/.local/bin:$PATH"

VOLUME /app/.state
VOLUME /home/claude/.claude

COPY --chmod=755 entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
