# Backend API for GROWW Weekly Pulse — deploy to Railway (or any Docker host)
FROM python:3.11-slim

WORKDIR /app

# Install system deps if any (optional; phase1 uses in-process scrapers)
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency file first for better layer caching
COPY requirements.txt .

# Install Python dependencies (includes phase1–3 and api server)
RUN pip install --no-cache-dir -r requirements.txt

# Copy app and pipeline code (needed for Phase 1 → 2a → 2b → 3)
COPY api_server.py web_ui.py ./
COPY phase1/    phase1/
COPY phase2a/   phase2a/
COPY phase2b/   phase2b/
COPY phase3/    phase3/
COPY phase4/    phase4/
COPY scripts/   scripts/

# Writable dirs for pipeline output (reviews, themes, output)
RUN mkdir -p reviews themes output

# Railway sets PORT at runtime; app must listen on 0.0.0.0:PORT
ENV PORT=8000
EXPOSE 8000

# Start script reads PORT from env and binds gunicorn (Railway-compatible)
RUN chmod +x scripts/start-api.sh
CMD ["./scripts/start-api.sh"]
