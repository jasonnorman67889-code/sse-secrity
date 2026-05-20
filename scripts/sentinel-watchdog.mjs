import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const WATCHDOG_INTERVAL_MS = Number(process.env.SENTINEL_WATCHDOG_INTERVAL_MS || 10_000);
const SENTINEL_NAME = process.env.SENTINEL_PROCESS_NAME || 'sovereign-sentinel';

async function isSentinelOnline() {
    try {
        const { stdout } = await execAsync(`pm2 jlist`);
        const processes = JSON.parse(stdout);
        const target = processes.find((proc) => proc?.name === SENTINEL_NAME);
        return target?.pm2_env?.status === 'online';
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[WATCHDOG] Failed to inspect PM2 state: ${message}`);
        return false;
    }
}

async function restartSentinel() {
    try {
        await execAsync(`pm2 restart ${SENTINEL_NAME}`);
        console.warn(`[WATCHDOG] Restarted ${SENTINEL_NAME} after offline detection.`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[WATCHDOG] Restart attempt failed: ${message}`);
    }
}

async function tick() {
    const online = await isSentinelOnline();
    if (!online) {
        await restartSentinel();
    } else {
        console.log(`[WATCHDOG] ${SENTINEL_NAME} healthy.`);
    }
}

console.log(
    `[WATCHDOG] Sentinel watchdog online. target=${SENTINEL_NAME} intervalMs=${WATCHDOG_INTERVAL_MS}`
);

setInterval(() => {
    void tick();
}, WATCHDOG_INTERVAL_MS);

void tick();
