FROM python:3.10-slim

# Install LibreOffice and fonts for doc parsing, plus Tesseract OCR
RUN apt-get update && \
    apt-get install -y --no-install-recommends libreoffice fonts-wqy-zenhei tesseract-ocr tesseract-ocr-eng && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire project into the container
COPY . .

# Expose port
ENV PORT=8080
ENV PYTHONUNBUFFERED=1
EXPOSE 8080

# Use gunicorn as the production WSGI server
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "8", "--timeout", "0", "app:app"]
