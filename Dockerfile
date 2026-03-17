FROM oven/bun:1

WORKDIR /app

# Install git, curl, bash (needed for Claude Code CLI install)
RUN apt-get update && apt-get install -y git curl bash && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Claude Code Agent SDK uses --dangerously-skip-permissions which is blocked for root
RUN useradd -m -s /bin/bash claude && \
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
