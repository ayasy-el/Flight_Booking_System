FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Create logs directory with proper permissions
RUN mkdir -p logs && \
    chown -R node:node logs

# Switch to non-root user
USER node

# Start the service
CMD ["npm", "start"] 