import { validateEnvAtStartup } from "@/env";

// Next only logs a failing register() and keeps the process up answering 500, so exit explicitly:
// a supervisor (Docker, systemd) then sees a failed start instead of a "healthy" broken server.
const EXIT_INVALID_CONFIG = 1;

export function assertEnvOrExit(): void {
  try {
    validateEnvAtStartup();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(EXIT_INVALID_CONFIG);
  }
}
