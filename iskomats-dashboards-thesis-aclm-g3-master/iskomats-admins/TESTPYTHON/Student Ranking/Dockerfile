FROM python:3.10-slim

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

# Expose port (Render sets PORT internally, often 10000, 
# but setting an EXPOSE is good practice)
EXPOSE 10000

# Start the application using python app.py 
# (Or whatever your start command used to be)
CMD ["python", "app.py"]
