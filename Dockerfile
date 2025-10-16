# Use Node.js 20 with Debian Bullseye (best for OCR libs)
FROM node:20-bullseye

# Install system dependencies for PDF & OCR
RUN apt-get update && apt-get install -y \
  poppler-utils \           
  # for pdftoppm
  tesseract-ocr \           
  # main OCR engine
  tesseract-ocr-eng \       
  # English language pack
  libtesseract-dev \        
  # dev headers (some builds need this)
  libleptonica-dev \        
  # image processing dependency
  && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of your project
COPY . .

# Expose your app port (same as .env)
EXPOSE 10000

# Run the API
CMD ["node", "extractWaterBillsAPI.js"]
