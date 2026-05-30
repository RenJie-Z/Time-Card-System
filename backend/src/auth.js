import crypto from 'node:crypto';

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function decodeBase64url(value) {
  return Buffer.from(value, 'base64url');
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const digest = crypto.pbkdf2Sync(password, salt, 210000, 32, 'sha256');
  return `pbkdf2_sha256$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

export function verifyPassword(password, storedHash) {
  const [algorithm, saltValue, digestValue] = storedHash.split('$');
  if (algorithm !== 'pbkdf2_sha256' || !saltValue || !digestValue) {
    return false;
  }
  const salt = decodeBase64url(saltValue);
  const expected = decodeBase64url(digestValue);
  const actual = crypto.pbkdf2Sync(password, salt, 210000, expected.length, 'sha256');
  return crypto.timingSafeEqual(actual, expected);
}

function getSecret() {
  return process.env.SECRET_KEY || 'change-me-in-development';
}

export function createAccessToken(userId) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { sub: String(userId), exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.createHmac('sha256', getSecret()).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

export function decodeAccessToken(token) {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) {
    throw new Error('Invalid token');
  }
  const signingInput = `${header}.${payload}`;
  const expected = crypto.createHmac('sha256', getSecret()).update(signingInput).digest('base64url');
  const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) {
    throw new Error('Invalid token');
  }
  const data = JSON.parse(decodeBase64url(payload).toString('utf8'));
  if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Expired token');
  }
  return data;
}
