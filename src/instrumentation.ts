// Runs once when the server starts. The Node-only check lives in its own module so the Edge
// bundle never sees process.exit.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertEnvOrExit } = await import("./instrumentation-node");
    assertEnvOrExit();
  }
}
