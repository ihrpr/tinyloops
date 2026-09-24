/**
 * Passkey (WebAuthn) client calls. The server builds the options and does
 * all verification; this only shuttles bytes between the API (base64url)
 * and the browser credential API (ArrayBuffers).
 */

import { api } from './api.js';

const dec = (s) => {
  let b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
};
const enc = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const passkeySupported = () =>
  Boolean(window.PublicKeyCredential && navigator.credentials?.create);

/** Register a passkey for the signed-in user (Face ID / fingerprint). */
export async function registerPasskey() {
  const opts = await api('/api/passkey/options', { method: 'POST', body: {} });
  const cred = await navigator.credentials.create({
    publicKey: {
      ...opts,
      challenge: dec(opts.challenge),
      user: { ...opts.user, id: dec(opts.user.id) },
    },
  });
  // getPublicKey() spares the server CBOR/attestation parsing; every
  // browser recent enough for resident-key passkeys has it
  if (!cred?.response?.getPublicKey) {
    throw new Error('This browser cannot save passkeys — you can still sign in with a new invite link.');
  }
  await api('/api/passkey/register', {
    method: 'POST',
    body: {
      id: cred.id,
      publicKey: btoa(String.fromCharCode(...new Uint8Array(cred.response.getPublicKey()))),
      alg: cred.response.getPublicKeyAlgorithm(),
      clientDataJSON: enc(cred.response.clientDataJSON),
      authenticatorData: enc(cred.response.getAuthenticatorData()),
    },
  });
}

/** Usernameless passkey sign-in; resolves once the session cookie is set. */
export async function passkeySignIn() {
  const opts = await api('/auth/passkey/options', { method: 'POST', body: {} });
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: dec(opts.challenge),
      rpId: opts.rpId,
      userVerification: opts.userVerification,
      timeout: opts.timeout,
    },
  });
  await api('/auth/passkey', {
    method: 'POST',
    body: {
      id: cred.id,
      clientDataJSON: enc(cred.response.clientDataJSON),
      authenticatorData: enc(cred.response.authenticatorData),
      signature: enc(cred.response.signature),
      userHandle: cred.response.userHandle ? enc(cred.response.userHandle) : null,
    },
  });
}

/** The user closing the OS passkey sheet is not an error worth showing. */
export const passkeyCancelled = (err) =>
  err?.name === 'NotAllowedError' || err?.name === 'AbortError';
