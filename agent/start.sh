#!/bin/bash
set -euo pipefail

echo "BuildBrain Agent VM - Starting..."

# Verify environment
if [ -z "${CONVEX_URL:-}" ]; then
  echo "ERROR: CONVEX_URL is not set" >&2
  exit 1
fi

if [ -z "${CONVEX_DEPLOY_KEY:-}" ]; then
  echo "ERROR: CONVEX_DEPLOY_KEY is not set" >&2
  exit 1
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "ERROR: ANTHROPIC_API_KEY is not set" >&2
  exit 1
fi

# Verify Python dependencies
python3 -c "import ifcopenshell; print(f'IfcOpenShell {ifcopenshell.version}')" || {
  echo "ERROR: ifcopenshell not installed" >&2
  exit 1
}

python3 -c "import pdfplumber; print(f'pdfplumber {pdfplumber.__version__}')" || {
  echo "ERROR: pdfplumber not installed" >&2
  exit 1
}

# Install Node dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing Node.js dependencies..."
  npm install
fi

# Create temp directory
mkdir -p "${TEMP_DIR:-/tmp/buildbrain}"

# Start the agent service
echo "Starting agent service..."
exec npx tsx src/index.ts
