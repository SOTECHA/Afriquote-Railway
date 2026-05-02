FROM node:22-alpine

WORKDIR /app

# Copy source
COPY . .

# Create data directory
RUN mkdir -p data uploads

# Seed demo data (optional — remove for production)
# RUN node scripts/seed.js

EXPOSE 4000

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:4000/health', r => process.exit(r.statusCode===200?0:1))"

CMD ["node", "server.js"]
