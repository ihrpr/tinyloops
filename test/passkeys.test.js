import { describe, it, expect } from 'vitest';
import {
  b64urlDecode, b64urlEncode, derToRaw, verifyRegistration, verifyAssertion,
} from '../server/passkeys.js';

// Real WebCrypto ceremonies: generate a P-256 keypair, build the exact byte
// structures a browser authenticator would send, and run them through the
// server-side verification. No mocks — if these pass, the crypto path works.

const RP_ID = 'tinyloops.app';
const ORIGIN = 'https://tinyloops.app';
const CHALLENGE = b64urlEncode(new TextEncoder().encode('x'.repeat(32)));

const utf8 = (s) => new TextEncoder().encode(s);

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

function clientData(type, challenge = CHALLENGE, origin = ORIGIN) {
  return b64urlEncode(utf8(JSON.stringify({ type, challenge, origin })));
}

/** authenticatorData: sha256(rpId) ‖ flags ‖ 4-byte counter. */
async function authData({ rpId = RP_ID, flags = 0x01, counter = 0 } = {}) {
  const out = new Uint8Array(37);
  out.set(await sha256(utf8(rpId)));
  out[32] = flags;
  new DataView(out.buffer).setUint32(33, counter);
  return b64urlEncode(out);
}

/** WebCrypto signs raw r||s; the wire format is DER — encode like a browser. */
function rawToDer(raw) {
  const int = (bytes) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let v = bytes.slice(i);
    if (v[0] & 0x80) v = new Uint8Array([0, ...v]);
    return new Uint8Array([0x02, v.length, ...v]);
  };
  const r = int(raw.slice(0, 32));
  const s = int(raw.slice(32));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

async function makeCredential(alg = -7) {
  const pair = await crypto.subtle.generateKey(
    alg === -7
      ? { name: 'ECDSA', namedCurve: 'P-256' }
      : { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return {
    alg,
    privateKey: pair.privateKey,
    publicKey: btoa(String.fromCharCode(...spki)),
  };
}

async function makeAssertion(cred, userId, {
  challenge = CHALLENGE, origin = ORIGIN, rpId = RP_ID, counter = 0, tamper = false,
} = {}) {
  const cdj = clientData('webauthn.get', challenge, origin);
  const ad = await authData({ rpId, counter });
  const adBytes = b64urlDecode(ad);
  const cdHash = await sha256(b64urlDecode(cdj));
  const signed = new Uint8Array([...adBytes, ...cdHash]);
  if (tamper) signed[0] ^= 0xff;
  // ES256 travels as DER; RS256 signatures are used as-is
  const sig = new Uint8Array(await crypto.subtle.sign(
    cred.alg === -7 ? { name: 'ECDSA', hash: 'SHA-256' } : 'RSASSA-PKCS1-v1_5',
    cred.privateKey, signed));
  return {
    id: 'cred-1',
    clientDataJSON: cdj,
    authenticatorData: ad,
    signature: b64urlEncode(cred.alg === -7 ? rawToDer(sig) : sig),
    userHandle: b64urlEncode(utf8(userId)),
  };
}

const row = (cred, { counter = 0 } = {}) => ({
  credential_id: 'cred-1', user_id: 'guest:abc',
  public_key: cred.publicKey, alg: cred.alg, counter,
});

const EXPECT = { challenge: CHALLENGE, origin: ORIGIN, rpId: RP_ID };

describe('passkey registration verification', () => {
  it('accepts a well-formed ES256 registration', async () => {
    const cred = await makeCredential();
    const out = await verifyRegistration({
      id: 'cred-1', publicKey: cred.publicKey, alg: -7,
      clientDataJSON: clientData('webauthn.create'),
      authenticatorData: await authData(),
    }, EXPECT);
    expect(out).toEqual({ credentialId: 'cred-1', publicKey: cred.publicKey, alg: -7 });
  });

  it('rejects wrong ceremony type, challenge, origin, rpId and unsupported alg', async () => {
    const cred = await makeCredential();
    const good = async (over = {}, expectOver = {}) => verifyRegistration({
      id: 'cred-1', publicKey: cred.publicKey, alg: -7,
      clientDataJSON: clientData('webauthn.create'),
      authenticatorData: await authData(),
      ...over,
    }, { ...EXPECT, ...expectOver });
    await expect(good({ clientDataJSON: clientData('webauthn.get') }))
      .rejects.toThrow(/ceremony/);
    await expect(good({}, { challenge: 'other' })).rejects.toThrow(/challenge/);
    await expect(good({}, { origin: 'https://evil.example' })).rejects.toThrow(/different site/);
    await expect(good({ authenticatorData: await authData({ rpId: 'evil.example' }) }))
      .rejects.toThrow(/different site/);
    await expect(good({ alg: -8 })).rejects.toThrow(/unsupported/);
    await expect(good({ publicKey: btoa('junk') })).rejects.toThrow();
  });

  it('rejects a response where the user was not present', async () => {
    const cred = await makeCredential();
    await expect(verifyRegistration({
      id: 'cred-1', publicKey: cred.publicKey, alg: -7,
      clientDataJSON: clientData('webauthn.create'),
      authenticatorData: await authData({ flags: 0x00 }),
    }, EXPECT)).rejects.toThrow(/not confirmed/);
  });
});

describe('passkey assertion verification', () => {
  it('verifies a genuine signature and returns the counter', async () => {
    const cred = await makeCredential();
    const body = await makeAssertion(cred, 'guest:abc', { counter: 7 });
    await expect(verifyAssertion(body, row(cred), EXPECT)).resolves.toBe(7);
  });

  it('rejects a tampered signature', async () => {
    const cred = await makeCredential();
    const body = await makeAssertion(cred, 'guest:abc', { tamper: true });
    await expect(verifyAssertion(body, row(cred), EXPECT)).rejects.toThrow(/sign-in failed/);
  });

  it('rejects a signature from a different key', async () => {
    const cred = await makeCredential();
    const other = await makeCredential();
    const body = await makeAssertion(other, 'guest:abc');
    await expect(verifyAssertion(body, row(cred), EXPECT)).rejects.toThrow(/sign-in failed/);
  });

  it('rejects a userHandle for a different account', async () => {
    const cred = await makeCredential();
    const body = await makeAssertion(cred, 'guest:SOMEONE-ELSE');
    await expect(verifyAssertion(body, row(cred), EXPECT)).rejects.toThrow(/different account/);
  });

  it('rejects a stripped userHandle (resident-key sign-in always carries one)', async () => {
    const cred = await makeCredential();
    const body = await makeAssertion(cred, 'guest:abc');
    delete body.userHandle;
    await expect(verifyAssertion(body, row(cred), EXPECT)).rejects.toThrow(/different account/);
  });

  it('verifies the RS256 branch end to end', async () => {
    const cred = await makeCredential(-257);
    const reg = await verifyRegistration({
      id: 'cred-1', publicKey: cred.publicKey, alg: -257,
      clientDataJSON: clientData('webauthn.create'),
      authenticatorData: await authData(),
    }, EXPECT);
    expect(reg.alg).toBe(-257);
    const good = await makeAssertion(cred, 'guest:abc', { counter: 2 });
    await expect(verifyAssertion(good, row(cred), EXPECT)).resolves.toBe(2);
    const bad = await makeAssertion(cred, 'guest:abc', { tamper: true });
    await expect(verifyAssertion(bad, row(cred), EXPECT)).rejects.toThrow(/sign-in failed/);
  });

  it('rejects a rolled-back counter (clone detection), tolerates always-zero', async () => {
    const cred = await makeCredential();
    const rolledBack = await makeAssertion(cred, 'guest:abc', { counter: 3 });
    await expect(verifyAssertion(rolledBack, row(cred, { counter: 5 }), EXPECT))
      .rejects.toThrow(/could not be verified/);
    // platform passkeys that never count: 0 stays acceptable forever
    const zero = await makeAssertion(cred, 'guest:abc', { counter: 0 });
    await expect(verifyAssertion(zero, row(cred, { counter: 0 }), EXPECT)).resolves.toBe(0);
  });
});

describe('derToRaw', () => {
  it('round-trips a WebCrypto signature through DER', async () => {
    const cred = await makeCredential();
    const msg = utf8('hello');
    const raw = new Uint8Array(await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, cred.privateKey, msg));
    expect(derToRaw(rawToDer(raw))).toEqual(raw);
  });

  it('rejects garbage, trailing bytes and a lying SEQUENCE length', async () => {
    expect(() => derToRaw(new Uint8Array([1, 2, 3]))).toThrow(/malformed/);
    const cred = await makeCredential();
    const raw = new Uint8Array(await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, cred.privateKey, utf8('hello')));
    const der = rawToDer(raw);
    expect(() => derToRaw(new Uint8Array([...der, 0x00]))).toThrow(/malformed/);
    const lying = new Uint8Array(der);
    lying[1] -= 1; // declared SEQUENCE length no longer covers the blob
    expect(() => derToRaw(lying)).toThrow(/malformed/);
  });
});
