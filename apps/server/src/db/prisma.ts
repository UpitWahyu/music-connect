import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

// Prisma 7 requires an explicit driver adapter for direct database access.
const adapter = new PrismaMariaDb(
  process.env.DATABASE_URL ?? "mysql://root:root@localhost:3306/music_connect",
);

export const prisma = new PrismaClient({ adapter });
