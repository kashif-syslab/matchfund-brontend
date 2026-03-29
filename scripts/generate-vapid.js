#!/usr/bin/env node
/** Run: node scripts/generate-vapid.js — paste keys into Backend .env */
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('Add to Backend .env:\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
console.log('\n(Keep the private key secret; public key is safe for the client.)');
