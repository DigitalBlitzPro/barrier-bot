// Encrypts software API keys before they are stored. Key: BARRIER_SECRETS_KEY, any random string of 32+ characters
// (Railway can generate one with ${{ secret(48) }}); it is hashed to a 32-byte AES key.
const crypto = require('crypto');

function key() {
  const raw = process.env.BARRIER_SECRETS_KEY || '';
  if (raw.length < 32) throw new Error('BARRIER_SECRETS_KEY must be at least 32 characters');
  return crypto.createHash('sha256').update(raw).digest();
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

function decrypt(stored) {
  const [iv, tag, enc] = String(stored).split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
