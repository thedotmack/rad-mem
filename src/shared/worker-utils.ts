import path from "path";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { getPackageRoot } from "./paths.js";

// Named constants for health checks
const HEALTH_CHECK_TIMEOUT_MS = 100;
const WORKER_STARTUP_WAIT_MS = 500;
const WORKER_STARTUP_RETRIES = 10;

/**
 * Get the RAD server port number
 * Priority: env var RAD_MEM_PORT > default 38888
 */
export function getWorkerPort(): number {
  return parseInt(process.env.RAD_MEM_PORT || '38888', 10);
}

/**
 * Check if worker is responsive by trying the health endpoint
 */
async function isWorkerHealthy(): Promise<boolean> {
  try {
    const port = getWorkerPort();
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS)
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Start the worker using PM2
 */
async function startWorker(): Promise<boolean> {
  try {
    // Find the ecosystem config file (built version in plugin/)
    const pluginRoot = getPackageRoot();
    const ecosystemPath = path.join(pluginRoot, 'ecosystem.config.cjs');

    if (!existsSync(ecosystemPath)) {
      throw new Error(`Ecosystem config not found at ${ecosystemPath}`);
    }

    // Start using PM2 with the ecosystem config
    // CRITICAL: Must set cwd to pluginRoot so PM2 starts from marketplace directory
    execSync(`pm2 start "${ecosystemPath}"`, {
      cwd: pluginRoot,
      stdio: 'pipe',
      encoding: 'utf-8'
    });

    // Wait for worker to become healthy
    for (let i = 0; i < WORKER_STARTUP_RETRIES; i++) {
      await new Promise(resolve => setTimeout(resolve, WORKER_STARTUP_WAIT_MS));
      if (await isWorkerHealthy()) {
        return true;
      }
    }

    return false;
  } catch (error) {
    // Failed to start worker
    return false;
  }
}

/**
 * Ensure worker service is running
 * Checks health and auto-starts if not running
 */
export async function ensureWorkerRunning(): Promise<void> {
  // Check if already healthy
  if (await isWorkerHealthy()) {
    return;
  }

  // Try to start the worker
  const started = await startWorker();

  if (!started) {
    const port = getWorkerPort();
    throw new Error(
      `Worker service failed to start on port ${port}.\n\n` +
      `Try manually running: pm2 start ecosystem.config.cjs\n` +
      `Or restart: pm2 restart rad-mem-worker`
    );
  }
}
