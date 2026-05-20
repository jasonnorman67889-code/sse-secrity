import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvFile() {
	const envPath = resolve(process.cwd(), '.env');
	const env = {};

	const contents = readFileSync(envPath, 'utf8');
	for (const line of contents.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}

		const separatorIndex = trimmed.indexOf('=');
		if (separatorIndex === -1) {
			continue;
		}

		const key = trimmed.slice(0, separatorIndex).trim();
		let value = trimmed.slice(separatorIndex + 1).trim();

		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		env[key] = value;
	}

	return env;
}

async function run() {
	const env = loadEnvFile();
	const token = env.TELEGRAM_BOT_TOKEN;
	const chatId = env.TELEGRAM_CHAT_ID;

	if (!token || !chatId) {
		console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env');
		process.exitCode = 1;
		return;
	}

	const text = 'Sovereign Node LA-01: Connectivity Test';
	const url = `https://api.telegram.org/bot${token}/sendMessage`;

	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chat_id: chatId,
				text
			})
		});

		const body = await response.text();
		console.log(`HTTP ${response.status}`);
		console.log(body);

		if (!response.ok) {
			process.exitCode = 1;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Network error: ${message}`);
		process.exitCode = 1;
	}
}

run();
