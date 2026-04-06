FROM node:20-slim

# Install LibreOffice for DOCX → PDF conversion
RUN apt-get update && apt-get install -y \
    libreoffice \
    --no-install-recommends \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
