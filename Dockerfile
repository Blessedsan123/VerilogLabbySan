# RTL Bench — Dockerfile
# Builds a container with iverilog and verilator pre-installed
# so users can deploy to any cloud and everyone can use the webapp
# without installing anything on their own machine.

FROM node:20-slim

# Install Icarus Verilog and Verilator
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      iverilog \
      verilator \
      yosys \
      make \
      g++ \
      ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application files
COPY server.js vcd-parser.js ./
COPY index.html styles.css app.js ./

# Expose port and start server
EXPOSE 3001
CMD ["node", "server.js"]
