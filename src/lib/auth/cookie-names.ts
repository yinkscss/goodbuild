/**
 * `__Host-` cookies can't be set by a subdomain. Published apps run generated code on
 * <slug>.goodbuildit.xyz, so in production this stops one overwriting the session on the main site.
 * The prefix needs a secure context, so development keeps the plain names.
 */
const prefix = process.env.NODE_ENV === "production" ? "__Host-" : "";

export const SESSION_COOKIE = `${prefix}gb_session`;
export const NONCE_COOKIE = `${prefix}gb_siwe_nonce`;
/** A visitor's session in one published app (docs/APP_DATA.md). Never the same cookie as SESSION_COOKIE. */
export const APP_SESSION_COOKIE = `${prefix}gbapp_session`;
