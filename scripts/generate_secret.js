/**
 * Generates a cryptographically secure JWT_SECRET.
 * Run: node scripts/generate_secret.js
 * Copy the output into your .env file.
 */
'use strict';
const crypto = require('crypto');
const secret = crypto.randomBytes(64).toString('hex');
console.log('\nGenerated JWT_SECRET (copy to .env):\n');
console.log(`JWT_SECRET=${secret}\n`);
