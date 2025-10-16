# Dockerfile
FROM node:20-slim

# 🧰 Install native OCR + PDF tools
RUN apt-get update && \
    apt-get install -y tesseract-ocr poppler-utils && \
    rm -rf /var/lib/apt/lists/*

# 🏗️ Create work directory
WORKDIR /app
# Copy everything explicitly, including templates
COPY . .
RUN mkdir -p /app/templates
COPY templates /app/templates


# 📦 Install JS deps
RUN npm install

ENV PORT=10000
EXPOSE 10000

# 🚀 Start API
CMD ["node", "extractWaterBillsAPI.js"]
