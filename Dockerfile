FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy app source
COPY . .

# Create data directory for SQLite
RUN mkdir -p /data

# Expose port
EXPOSE 3000

CMD ["node", "server.js"]
