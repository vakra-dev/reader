# Reader Docker Image
# Containerizes the Express server example with Hero browser

FROM node:22-slim

# Install Chrome dependencies for Hero (based on Ulixee Cloud Docker setup)
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    curl \
    # Fonts for proper rendering
    fonts-liberation \
    fonts-freefont-ttf \
    # Virtual framebuffer for headless Chrome
    xvfb \
    # Chrome dependencies
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    libxss1 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Configure shared memory for Chrome
RUN chmod +x /dev/shm

# Set working directory
WORKDIR /app

# Copy reader package
COPY package.json ./
COPY src ./src

# Install reader dependencies
RUN npm install

# Copy examples package.json and install
COPY examples/package.json ./examples/
WORKDIR /app/examples
RUN npm install

# Install browser dependencies (official Ulixee method)
RUN npx install-browser-deps || true

# Copy express server code
COPY examples/production ./production

# Install tsx globally for running TypeScript
RUN npm install -g tsx

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Set display for xvfb
ENV DISPLAY=:99

# Run with xvfb virtual display for Chrome
CMD xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" tsx production/express-server/src/index.ts
