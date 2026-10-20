// Runs a real local PostgreSQL without Docker (binaries come from the embedded-postgres npm package).
// Usage: npm run db:local   (keep this terminal open; Ctrl+C stops the server)
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".pgdata");
const port = Number(process.env.PGPORT ?? 5432);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
  // Windows defaults to WIN1252, which can't store emoji or most non-Latin text from web pages.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
  console.log("Initialising a new database cluster in .pgdata ...");
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase("agentguard");
  console.log("Created database 'agentguard'");
} catch {
  // already exists
}
console.log(`PostgreSQL ready: postgresql://postgres:postgres@localhost:${port}/agentguard`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
