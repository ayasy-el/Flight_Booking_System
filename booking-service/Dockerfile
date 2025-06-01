FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

RUN apk update && apk add --no-cache openssl

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Create logs directory with proper permissions
RUN mkdir -p logs && \
    chown -R node:node logs

# Generate Prisma client
RUN npx prisma generate

# Switch to non-root user
USER node

# Expose port
EXPOSE 50051

# Start the service
CMD ["npm", "start"] 