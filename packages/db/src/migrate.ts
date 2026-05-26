import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db, sqlite } from "./index";

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
migrate(db, { migrationsFolder: join(here, "..", "drizzle") });
sqlite.close();
console.log("Migrations applied.");
