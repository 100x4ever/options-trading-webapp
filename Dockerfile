FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code files
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Expose server port (Railway dynamically injects PORT env variable)
EXPOSE 8080

# Command to run uvicorn
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
