FROM node:18-bullseye

# Install Poppler (for pdftoppm)
RUN apt-get update && apt-get install -y poppler-utils

# Create app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Expose API port
EXPOSE 3000

# Run the API
CMD ["node", "extractWaterBillsAPI.js"]
