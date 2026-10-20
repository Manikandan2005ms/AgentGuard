/**
 * Seeds the demo data (see src/services/demoSeed.ts).
 *   npm run seed            idempotent; keeps a policy you confirmed
 *   npm run seed -- --reset also wipes payment requests and tasks and restores the sample policy
 */
import { prisma } from "../src/db";
import { seedDemo } from "../src/services/demoSeed";

seedDemo({ reset: process.argv.includes("--reset") })
  .then((lines) => lines.forEach((l) => console.log(l)))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
