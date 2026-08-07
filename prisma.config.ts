// Prisma 7 config (Prisma 7 moved the connection URL out of schema.prisma).
// https://pris.ly/d/config-datasource
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "mysql://root:root@localhost:3306/music_connect",
  },
});
