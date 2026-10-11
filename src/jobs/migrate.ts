// `npm run migrate` -- also run by the deploy workflow before each deploy.
import { migrate } from "../migrate.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
await migrate(url);
