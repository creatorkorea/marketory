FROM ghcr.io/astral-sh/uv:0.10.4 AS uv
FROM python:3.12.10-slim
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_LINK_MODE=copy PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH"
COPY pyproject.toml uv.lock ./
COPY src ./src
RUN uv sync --locked --no-dev --no-editable && useradd --create-home app
USER app
EXPOSE 8000
CMD ["sh", "-c", "uvicorn marketory.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
