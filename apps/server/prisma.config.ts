// Local Prisma config so `prisma` commands run from apps/server (e.g. the
// build script) resolve the shared schema at the monorepo root.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "../../prisma/schema.prisma",
  migrations: {
    path: "../../prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "mysql://root:root@localhost:3306/music_connect",
  },
});
