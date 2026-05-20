import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvFile() {
    const envPath = resolve(process.cwd(), '.env');
    const env = {};
    const raw = readFileSync(envPath, 'utf8');

    for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;

        const i = t.indexOf('=');
        if (i === -1) continue;

        const k = t.slice(0, i).trim();
        let v = t.slice(i + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
        }
        env[k] = v;
    }

    return env;
}

const env = loadEnvFile();
const token = env.TELEGRAM_BOT_TOKEN || '';
const chatId = env.TELEGRAM_CHAT_ID || '';

console.log(
    JSON.stringify({
        hasToken: Boolean(token),
        hasChatId: Boolean(chatId),
        tokenPrefix: token ? token.slice(0, 10) : null,
        tokenLength: token.length,
        chatId,
        chatIdFormatOk: /^-?\d+$/.test(chatId)
    })
);
