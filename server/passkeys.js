/**
 * Passkey (WebAuthn) sign-in — dependency-free, WebCrypto only.
 *
 * Why: a caregiver who joined by link has no Google account, and the
 * home-screen web app keeps its own cookie jar, so their join-link session
 * doesn't carry over. A passkey is OS-level (iCloud Keychain / Google
 * Password Manager), so it works across both — register once, sign back in
 * with Face ID anywhere. Google users may register one too.
 *
 * No CBOR/attestation parsing: registration trusts the browser's
 * AuthenticatorAttestationResponse.getPublicKey() (SPKI DER), which is fine
 * because we never rely on attestation — the credential is trusted exactly
 * as much as the session that registered it. We still verify challenge,
 * origin, rpIdHash and flags on both ceremonies, and login verifies the
 * assertion signature against the stored key.
 */

import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomToken, sha256Hex, cookieOpts, createSession, b64dec } from './auth.js';
import { UserFacingError } from './errors.js';

const REG_CHAL_COOKIE = 'tl.regchal';
const AUTH_CHAL_COOKIE = 'tl.authchal';
const CHAL_MAX_AGE_S = 300;
const MAX_PASSKEYS_PER_USER = 10;
const COSE_ES256 = -7;
const COSE_RS256 = -257;

// ---------- byte helpers ----------

export const b64urlDecode = (s) => {
  let b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
};

export const b64urlEncode = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sha256Bytes(input) {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

/** WebAuthn ES256 signatures are DER SEQUENCE(r, s); WebCrypto wants raw
 *  r||s with each padded to 32 bytes. */
export function derToRaw(der) {
  const fail = () => { throw new UserFacingError('That passkey signature is malformed.'); };
  if (der.length < 8 || der[0] !== 0x30) fail();
  // P-256 signatures fit in one length byte; the declared length must cover
  // the rest of the blob exactly (no trailing bytes)
  if (der[1] & 0x80 || der[1] !== der.length - 2) fail();
  let i = 2;
  const readInt = () => {
    if (der[i++] !== 0x02) fail();
    let len = der[i++];
    let start = i;
    i += len;
    if (i > der.length) fail();
    // strip the sign-padding zero byte; then left-pad to 32
    while (len > 32 && der[start] === 0) { start++; len--; }
    if (len > 32) fail();
    const out = new Uint8Array(32);
    out.set(der.slice(start, start + len), 32 - len);
    return out;
  };
  const r = readInt();
  const s = readInt();
  if (i !== der.length) fail(); // both INTEGERs must consume the SEQUENCE
  const raw = new Uint8Array(64);
  raw.set(r); raw.set(s, 32);
  return raw;
}

// ---------- ceremony verification (pure — unit-tested) ----------

/** Shared checks for both ceremonies: clientDataJSON (type, challenge,
 *  origin) and authenticatorData (rpIdHash, user-present flag). Returns the
 *  raw authenticatorData bytes. NB the challenge check here is against the
 *  caller's `expect` — the anti-replay binding is takeChallenge() comparing
 *  the echoed value to the hashed single-use cookie; don't remove either. */
async function verifyCeremony({ clientDataJSON, authenticatorData }, expect) {
  const clientBytes = b64urlDecode(clientDataJSON);
  let client;
  try {
    client = JSON.parse(new TextDecoder().decode(clientBytes));
  } catch {
    throw new UserFacingError('That passkey response is malformed.');
  }
  if (client.type !== expect.type) throw new UserFacingError('Wrong passkey ceremony type.');
  if (client.challenge !== expect.challenge) {
    throw new UserFacingError('The passkey challenge did not match — please try again.');
  }
  if (client.origin !== expect.origin) {
    throw new UserFacingError('That passkey response came from a different site.');
  }
  const authData = b64urlDecode(authenticatorData);
  if (authData.length < 37) throw new UserFacingError('That passkey response is malformed.');
  const rpIdHash = await sha256Bytes(expect.rpId);
  if (!rpIdHash.every((b, i) => authData[i] === b)) {
    throw new UserFacingError('That passkey belongs to a different site.');
  }
  if (!(authData[32] & 0x01)) { // UP: user presence
    throw new UserFacingError('The passkey was not confirmed on the device.');
  }
  return { authData, clientBytes };
}

/** Verify a registration response; returns the row fields to store. */
export async function verifyRegistration(body, expect) {
  await verifyCeremony(body, { ...expect, type: 'webauthn.create' });
  const alg = Number(body.alg);
  if (alg !== COSE_ES256 && alg !== COSE_RS256) {
    throw new UserFacingError('This device offered an unsupported passkey type.');
  }
  const publicKey = String(body.publicKey || '');
  const credentialId = String(body.id || '');
  if (!credentialId || credentialId.length > 1024 || !publicKey || publicKey.length > 4096) {
    throw new UserFacingError('That passkey response is malformed.');
  }
  // import now to reject junk at registration time, not at first sign-in
  await importKey(publicKey, alg);
  return { credentialId, publicKey, alg };
}

function importKey(publicKeyB64, alg) {
  const spki = b64dec(String(publicKeyB64));
  return alg === COSE_ES256
    ? crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    : crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

/** Verify an assertion (login) against a stored credential row. Returns the
 *  authenticator's new signature counter. */
export async function verifyAssertion(body, row, expect) {
  const { authData, clientBytes } = await verifyCeremony(body, { ...expect, type: 'webauthn.get' });
  // resident-key sign-in always carries a userHandle — its absence is a
  // stripped response, not a legacy authenticator
  if (!body.userHandle || body.userHandle !== b64urlEncode(new TextEncoder().encode(row.user_id))) {
    throw new UserFacingError('That passkey belongs to a different account.');
  }
  // signed message = authenticatorData || SHA-256(clientDataJSON)
  const clientHash = await sha256Bytes(clientBytes);
  const signed = new Uint8Array(authData.length + clientHash.length);
  signed.set(authData); signed.set(clientHash, authData.length);
  const sigBytes = b64urlDecode(body.signature);
  const key = await importKey(row.public_key, row.alg);
  const ok = row.alg === COSE_ES256
    ? await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(sigBytes), signed)
    : await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sigBytes, signed);
  if (!ok) throw new UserFacingError('Passkey sign-in failed — please try again.');
  // clone detection: a counter that moved backwards means two authenticators
  // share the key (many platform passkeys always report 0, so only enforce
  // when the authenticator actually counts)
  const counter = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0);
  if (counter !== 0 && counter <= row.counter) {
    throw new UserFacingError('This passkey could not be verified — register a new one.');
  }
  return counter;
}

// ---------- route handlers ----------

const rpId = (c) => new URL(c.req.url).hostname;
const origin = (c) => new URL(c.req.url).origin;

/** Issue a challenge, remembered in a short-lived httpOnly cookie (hashed,
 *  like sessions, so a D1 read can't replay it). */
async function issueChallenge(c, cookieName) {
  const challenge = randomToken();
  setCookie(c, cookieName, await sha256Hex(challenge),
    cookieOpts(c, { path: '/', maxAge: CHAL_MAX_AGE_S }));
  return b64urlEncode(new TextEncoder().encode(challenge));
}

/** The challenge the client must have answered — read once, then cleared. */
async function takeChallenge(c, cookieName, clientChallenge) {
  const stored = getCookie(c, cookieName);
  deleteCookie(c, cookieName, { path: '/' });
  if (!stored || !clientChallenge) return false;
  let echoed;
  try {
    echoed = new TextDecoder().decode(b64urlDecode(clientChallenge));
  } catch {
    return false;
  }
  return (await sha256Hex(echoed)) === stored;
}

/** POST /api/passkey/options (session required) — registration options. */
export async function registerOptions(c) {
  const user = c.get('user');
  return c.json({
    rp: { id: rpId(c), name: 'tinyloops' },
    user: {
      id: b64urlEncode(new TextEncoder().encode(user.id)),
      name: user.name || user.email || 'caregiver',
      displayName: user.name || user.email || 'caregiver',
    },
    challenge: await issueChallenge(c, REG_CHAL_COOKIE),
    pubKeyCredParams: [
      { type: 'public-key', alg: COSE_ES256 },
      { type: 'public-key', alg: COSE_RS256 },
    ],
    // resident key required: sign-in offers no username field to match on
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    timeout: 60000,
  });
}

/** The challenge string echoed inside a response's clientDataJSON, or null
 *  on junk input (never throws — malformed input is a user-facing 400). */
function echoedChallenge(body) {
  try {
    const client = JSON.parse(new TextDecoder().decode(b64urlDecode(body.clientDataJSON || '')));
    return typeof client.challenge === 'string' ? client.challenge : null;
  } catch {
    return null;
  }
}

/** POST /api/passkey/register (session required) — store the credential. */
export async function register(c) {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const challenge = echoedChallenge(body);
  if (!await takeChallenge(c, REG_CHAL_COOKIE, challenge)) {
    throw new UserFacingError('The passkey request expired — please try again.');
  }
  const { credentialId, publicKey, alg } = await verifyRegistration(body, {
    challenge, origin: origin(c), rpId: rpId(c),
  });
  const count = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').bind(user.id).first();
  if (count.n >= MAX_PASSKEYS_PER_USER) {
    throw new UserFacingError('This account already has the maximum number of passkeys.');
  }
  // Never REPLACE across owners: credential ids arrive in the request body
  // and are not secrets, so an overwrite would let any signed-in user break
  // someone else's passkey. Re-registering your own credential id is fine.
  const existing = await c.env.DB.prepare(
    'SELECT user_id FROM passkeys WHERE credential_id = ?').bind(credentialId).first();
  if (existing && existing.user_id !== user.id) {
    throw new UserFacingError('That passkey is already registered to another account.');
  }
  if (existing) {
    await c.env.DB.prepare(
      'UPDATE passkeys SET public_key = ?, alg = ?, counter = 0, created_at = ? WHERE credential_id = ?')
      .bind(publicKey, alg, Date.now(), credentialId).run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO passkeys (credential_id, user_id, public_key, alg, counter, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`)
      .bind(credentialId, user.id, publicKey, alg, Date.now()).run();
  }
  return c.json({ ok: true });
}

/** POST /auth/passkey/options (no session) — assertion options. */
export async function signInOptions(c) {
  return c.json({
    rpId: rpId(c),
    challenge: await issueChallenge(c, AUTH_CHAL_COOKIE),
    userVerification: 'preferred',
    timeout: 60000,
  });
}

/** POST /auth/passkey (no session) — verify the assertion, mint a session. */
export async function signIn(c) {
  const body = await c.req.json().catch(() => ({}));
  const challenge = echoedChallenge(body);
  if (!await takeChallenge(c, AUTH_CHAL_COOKIE, challenge)) {
    throw new UserFacingError('The passkey request expired — please try again.');
  }
  // join users so a revoked caregiver's dangling credential can't sign in
  const row = await c.env.DB.prepare(
    `SELECT p.*, u.id AS uid FROM passkeys p JOIN users u ON u.id = p.user_id
     WHERE p.credential_id = ?`).bind(String(body.id || '')).first();
  if (!row) {
    throw new UserFacingError('This passkey is not registered here — ' +
      'sign in another way, or ask for a new invite link.');
  }
  const counter = await verifyAssertion(body, row, {
    challenge, origin: origin(c), rpId: rpId(c),
  });
  await c.env.DB.prepare('UPDATE passkeys SET counter = ? WHERE credential_id = ?')
    .bind(counter, row.credential_id).run();
  await createSession(c, row.user_id);
  return c.json({ ok: true });
}
