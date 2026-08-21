FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies resolve as root into system site-packages, before the
# unprivileged user takes over.
COPY pyproject.toml ./
# setuptools leaves build/ and *.egg-info behind in the workdir; dropping them
# in the same layer keeps them out of the image entirely.
RUN pip install --upgrade pip \
    && pip install . \
    && rm -rf /app/build /app/*.egg-info

COPY . .

# The service never writes to its own source tree, so application files stay
# owned by root and the process runs as a user that cannot modify them. A
# code-execution bug then cannot rewrite the code it is running from.
RUN useradd --system --create-home --uid 10001 lura && chown -R root:root /app
USER lura

EXPOSE 8000

# Uses the app's own /health route, so the check fails when the process is up
# but the application is not actually serving.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).status == 200 else 1)"

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
