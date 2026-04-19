# Use official Node image
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./

RUN npm install --production

# Copy all source code
COPY . .

# Expose port
EXPOSE 3000

# Start API
CMD ["node", "app/index.js"]