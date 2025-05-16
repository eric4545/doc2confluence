FROM node:18-alpine AS builder

# Set up working directory
WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Create a smaller production image
FROM node:18-alpine AS production

# Set environment variables
ENV NODE_ENV=production

# Create a non-root user and group
RUN addgroup -S docuser && \
    adduser -S docuser -G docuser && \
    mkdir -p /home/docuser/.config /home/docuser/.cache && \
    chown -R docuser:docuser /home/docuser

# Set working directory
WORKDIR /app

# Copy only the built app from the previous stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Install only production dependencies (no devDependencies)
RUN npm ci --only=production --omit=dev && \
    npm cache clean --force && \
    chown -R docuser:docuser /app

# Set the home directory for the non-root user
ENV HOME=/home/docuser

# Switch to non-root user
USER docuser

# Make the CLI available globally
RUN npm link

# Set the entrypoint to use the CLI command directly
ENTRYPOINT ["doc2conf"]

# Default command is to show help
CMD ["--help"]

# Add labels for better metadata
LABEL org.opencontainers.image.title="doc2confluence" \
      org.opencontainers.image.description="Convert documentation files (Markdown, AsciiDoc, CSV) to Confluence ADF format" \
      org.opencontainers.image.source="https://github.com/eric4545/doc2confluence" \
      org.opencontainers.image.licenses="MIT"