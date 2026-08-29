/**
 * Errors whose message is safe and useful to show in the UI. The router's
 * onError maps any UserFacingError to a 400 with its message; everything
 * else becomes an opaque 500.
 */
export class UserFacingError extends Error {}
