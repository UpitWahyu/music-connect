/**
 * JWT helpers — access + refresh tokens.
 *
 * Uses `fast-jwt` (NOT jsonwebtoken). Access tokens are short-lived (12h) and
 * stateless; refresh tokens are long-lived (7d), signed with REFRESH_SECRET, and
 * persisted (hashed) in the RefreshToken table so they can be rotated/invalidated.
 *
 * The existing @fastify/jwt access-secret bootstrapping is untouched — this module
 * only adds the refresh-token machinery on top and exposes access-token signing so
 * login/refresh stay consistent.
 */
import { createSigner, createVerifier } from "fast-jwt";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { sha256 } from "../utils.js";

const ACCESS_TTL_SECONDS = 12 * 60 * 60; // 12h
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7d

export interface AccessClaims {
  sub: string;
  username: string;
  /** "refresh" on refresh tokens, "access" on access tokens. */
  typ: "access" | "refresh";
}

const accessSigner = createSigner({
  key: config.jwtSecret,
  expiresIn: ACCESS_TTL_SECONDS,
  algorithm: "HS256",
});

const refreshSigner = createSigner({
  key: config.refreshSecret,
  expiresIn: REFRESH_TTL_SECONDS,
  algorithm: "HS256",
});

const refreshVerifier = createVerifier({ key: config.refreshSecret, algorithms: ["HS256"] });

export interface SignedAccess {
  token: string;
  expiresAt: Date;
}

/** Sign a short-lived access token. */
export function signAccessToken(userId: string, username: string): SignedAccess {
  const token = accessSigner({ sub: userId, username, typ: "access" });
  return { token, expiresAt: new Date(Date.now() + ACCESS_TTL_SECONDS * 1000) };
}

export interface SignedRefresh {
  token: string;
  expiresAt: Date;
}

/** Sign a long-lived refresh token (raw JWT — store its hash in the DB). */
export function signRefreshToken(userId: string): SignedRefresh {
  // jti makes every refresh JWT cryptographically unique (even two minted in
  // the same second share an `iat`, so without it their hashes would collide on
  // the @unique column). It also gives each token a stable, loggable identity.
  const token = refreshSigner({ sub: userId, typ: "refresh", jti: randomUUID() });
  return { token, expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000) };
}

/** Verify a refresh token's signature + expiry. Returns null if invalid. */
export function verifyRefreshToken(raw: string): { sub: string; typ: "refresh" } | null {
  try {
    const payload = refreshVerifier(raw) as { sub: string; typ: "refresh" };
    if (payload.typ !== "refresh") return null;
    return { sub: payload.sub, typ: "refresh" };
  } catch {
    // expired / invalid signature / malformed — treat all as "not a valid refresh token"
    return null;
  }
}

/** SHA-256 hash of a raw refresh JWT — the only form we persist. */
export function hashRefreshToken(raw: string): string {
  return sha256(raw);
}
