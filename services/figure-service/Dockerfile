FROM python:3.12-slim

# opencv-python-headless still needs libglib; nothing else required for torch CPU.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app
COPY pyproject.toml ./
RUN uv sync --no-dev

COPY . .

# Bake model weights into the image so the first request isn't slow / network-bound.
# (UVDoc weights ship inside py-reform; this also pulls the DocLayout-YOLO checkpoint.)
RUN uv run python -c "import pipeline; pipeline.warmup()"

EXPOSE 8000
# One worker: the models are large and held in memory; use threads for concurrency.
CMD ["uv", "run", "gunicorn", "-w", "1", "-k", "gthread", "--threads", "4", \
     "--timeout", "120", "-b", "0.0.0.0:8000", "app:app"]
