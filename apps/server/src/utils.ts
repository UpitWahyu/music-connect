import { createHash } from "node:crypto";

/** Device tokens are stored hashed (PRD §30) — never in plaintext. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
