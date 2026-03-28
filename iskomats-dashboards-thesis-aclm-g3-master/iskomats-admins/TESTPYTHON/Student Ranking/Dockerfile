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
RUN python -c "from uniface import RetinaFace, ArcFace; RetinaFace(); ArcFace()"

# Expose port (Render sets PORT internally, often 10000, 
# but setting an EXPOSE is good practice)
EXPOSE 10000

# Start the application using python app.py 
# (Or whatever your start command used to be)
CMD ["python", "app.py"]
