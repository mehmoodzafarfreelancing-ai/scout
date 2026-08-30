import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Load .env.local for CLI scripts.
 *
 * Next injects env files automatically; a bare `tsx` process does not. Uses
 * Node's built-in loader rather than adding dotenv — one fewer dependency in
 * the CI job. Real environment variables always win, which is what GitHub
 * Actions and Vercel need.
 */
export function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    const full = path.resolve(process.cwd(), file);
    if (!existsSync(full)) continue;
    try {
      process.loadEnvFile(full);
    } catch (err) {
      console.warn(`[env] could not read ${file}: ${String(err)}`);
    }
  }
}
