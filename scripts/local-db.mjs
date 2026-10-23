// Runs a real local PostgreSQL without Docker (binaries come from the embedded-postgres npm package).
// Usage: npm run db:local   (keep this terminal open; Ctrl+C stops the server)
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".pgdata");

// The password comes from POSTGRES_PASSWORD in the root .env, so none is kept in the repo.
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // no .env: use the shell environment
}
const password = process.env.POSTGRES_PASSWORD;
if (!password) {
  console.error("Set POSTGRES_PASSWORD in .env (see .env.example) and use the same password in DATABASE_URL.");
  process.exit(1);
}
const port = Number(process.env.PGPORT ?? 5432);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password,
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
} catch (err) {
  // 42P04 = already exists. Anything else is usually a password that doesn't match the one .pgdata was created with.
  if (err?.code !== "42P04") {
    console.error(`Could not create database 'agentguard': ${err?.message ?? err}`);
    console.error("POSTGRES_PASSWORD must be the password .pgdata was first created with (or delete .pgdata to start over).");
  }
}
console.log(`PostgreSQL ready: postgresql://postgres:<POSTGRES_PASSWORD>@localhost:${port}/agentguard`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
