FROM node:20-slim AS base

# Install Python and build dependencies for IfcOpenShell
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN python3 -m pip install --break-system-packages \
    ifcopenshell>=0.8.0 \
    pdfplumber>=0.10.0 \
    pandas>=2.0.0

WORKDIR /app

# Install Node.js dependencies
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy agent source
COPY src/ ./src/
COPY tsconfig.json ./

# Copy CLI tools from buildbrain and buildkit
COPY cli-tools/ ./cli-tools/

# Environment
ENV NODE_ENV=production
ENV CLI_TOOLS_DIR=/app/cli-tools/buildbrain
ENV BUILDKIT_TOOLS_DIR=/app/cli-tools/buildkit
ENV TEMP_DIR=/tmp/buildbrain
ENV HEALTH_PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["npx", "tsx", "src/index.ts"]
