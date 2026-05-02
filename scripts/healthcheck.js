/**
 * AfriQuote — Healthcheck script
 * Usage: node scripts/healthcheck.js [port]
 * Exit 0 = healthy, Exit 1 = unhealthy
 */
'use strict';
const http = require('http');
const port = parseInt(process.argv[2]) || parseInt(process.env.PORT) || 4000;
http.get(`http://localhost:${port}/health`, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    try {
      const data = JSON.parse(body);
      if (data.status === 'ok') {
        console.log(`✓ API healthy on port ${port}`);
        process.exit(0);
      }
    } catch {}
    console.error('✗ API unhealthy:', body);
    process.exit(1);
  });
}).on('error', err => {
  console.error(`✗ Cannot reach API on port ${port}:`, err.message);
  process.exit(1);
});
