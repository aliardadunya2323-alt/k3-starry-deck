import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {seal} from './protect.mjs';
const password = 'test-only-random-fixture';
const html = '<h1>fixture</h1>', app = 'globalThis.fixture = true;';
const bytes = await seal(html, app, password);
async function open(data, candidate) {
  const material = await webcrypto.subtle.importKey('raw', Buffer.from(candidate), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({name:'PBKDF2', salt:data.subarray(4,20), iterations:600000, hash:'SHA-256'}, material, {name:'AES-GCM', length:256}, false, ['decrypt']);
  return JSON.parse(Buffer.from(await webcrypto.subtle.decrypt({name:'AES-GCM', iv:data.subarray(20,32)}, key, data.subarray(32))).toString());
}
assert.deepEqual(await open(bytes,password), {version:1,html,app});
await assert.rejects(open(bytes,'incorrect'));
const altered = Buffer.from(bytes); altered[altered.length-1] ^= 1;
await assert.rejects(open(altered,password));
assert(!bytes.includes(Buffer.from(password)));
assert(!bytes.includes(Buffer.from(app)));
console.log('PASS: correct code, wrong code, tamper rejection, no plaintext credentials or app.');
