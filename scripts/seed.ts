/**
 * Seed the admin user (PRD §41 D-03: single user for V1).
 *
 * The password is generated on first run and appended to the root .env as
 * ADMIN_PASSWORD (dev only — .env is gitignored). Re-running updates the
 * password hash from the current ADMIN_PASSWORD.
 *
 * Usage: pnpm db:seed
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { prisma } from "../apps/server/src/db/prisma.js";
import { hashPassword } from "../apps/server/src/api/auth.js";

const envPath = new URL("../.env", import.meta.url);

async function main(): Promise<void> {
  let env = readFileSync(envPath, "utf8");

  if (!env.includes("ADMIN_PASSWORD")) {
    const pw = randomBytes(12).toString("hex");
    writeFileSync(envPath, env + `\nADMIN_PASSWORD=${pw}\n`);
    console.log("[seed] ADMIN_PASSWORD generated and appended to .env (dev only)");
    env = readFileSync(envPath, "utf8");
  } else {
    console.log("[seed] using existing ADMIN_PASSWORD from .env");
  }

  const password = env.match(/ADMIN_PASSWORD=(\S+)/)?.[1];
  if (!password) throw new Error("ADMIN_PASSWORD missing from .env");

  const hash = hashPassword(password);
  const user = await prisma.user.upsert({
    where: { username: "admin" },
    update: { passwordHash: hash },
    create: { username: "admin", passwordHash: hash },
  });

  console.log(`[seed] user ready: ${user.username} (${user.id})`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
