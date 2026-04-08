FROM python:3.10-slim

# Encourage Python to flush logs and OS to reclaim memory
ENV PYTHONUNBUFFERED=1 \
    MALLOC_TRIM_THRESHOLD_=100000

# Install system dependencies
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    libtesseract-dev \
    libgl1 \
    libglib2.0-0 \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements and install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all application files
COPY . .

# Pre-download models to avoid timeouts on first request
RUN python -c "from uniface import RetinaFace, ArcFace; print('[Docker Build] Initializing RetinaFace...'); RetinaFace(); print('[Docker Build] Initializing ArcFace...'); ArcFace(); print('[Docker Build] Model initialization complete.')"

# Expose port (Render sets PORT internally, often 10000, 
# but setting an EXPOSE is good practice)
EXPOSE 10000

# Health check - simple endpoint without dependencies
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:10000/_health || exit 1

# Start the application using python app.py 
CMD ["python", "app.py"]
