# E2E test image — runs consumer_local.py (plain Kafka consumer, no Modal).
# Production uses Modal; see src/main.py and TICKET-015.
FROM python:3.12-slim

WORKDIR /app

COPY requirements-e2e.txt ./
RUN pip install --no-cache-dir -r requirements-e2e.txt

COPY src/ ./src/

CMD ["python", "-u", "src/consumer_local.py"]
