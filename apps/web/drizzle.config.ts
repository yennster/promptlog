import { defineConfig } from "drizzle-kit";
import { DB_PATH } from "@promptlog/shared";

export default defineConfig({
  schema: "../../packages/db/src/schema.ts",
  out: "../../packages/db/drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: DB_PATH,
  },
});
