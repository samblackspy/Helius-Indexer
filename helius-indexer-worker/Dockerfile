# Dockerfile for helius-indexer-worker

# --- Stage 1: Build Environment ---
# Use a Node.js LTS version as the base image for building
FROM node:20 AS builder

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (or yarn.lock)
COPY package*.json ./

# Install all dependencies (including devDependencies needed for build)
RUN npm ci

# Copy the rest of the application source code
COPY . .

# Compile TypeScript to JavaScript
RUN npm run build

# Remove development dependencies after build
RUN npm prune --production

# --- Stage 2: Runtime Environment ---
# Use a smaller Node.js image for the final runtime
FROM node:20-slim

# Set the working directory
WORKDIR /app

# Copy only necessary files from the builder stage:
# - Production node_modules
# - Compiled JavaScript code (dist)
# - package.json (needed for Node.js to identify the module)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Metadata (Optional)
LABEL maintainer="Your Name <your.email@example.com>"
LABEL description="Background worker for Helius Supabase Indexer"

# The worker doesn't expose a port, so EXPOSE is not needed

# Command to run the worker when the container starts
# It reads environment variables set in the runtime environment (e.g., Render, Fly.io, Cloud Run)
CMD [ "node", "dist/index.js" ]