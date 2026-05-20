import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';

const PUBLIC_MACHINE_API_PREFIXES = [
	'/api/identity-events',
	'/api/risk/spam-events',
	'/api/risk/identity-logs',
	'/api/risk/email-spam-events',
	'/api/risk/login-spam-events',
	'/api/risk/bank-phish-events',
	'/api/risk/card-fraud-events',
	'/api/lab/email-direct-spam-plane',
	'/api/lab/login-threat-plane',
	'/api/lab/banking-phish-plane',
	'/api/lab/card-fraud-plane',
	'/api/lab/synthetic-attack-engine',
	'/api/soc/autonomous-analyst',
	'/api/soc/chat',
	'/api/risk/reality-replay/118',
	'/api/risk/reality-replay/441',
	'/api/risk/reality-replay/991',
	'/api/stream/biometric',
	'/api/threat-intel'
];

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	if (PUBLIC_MACHINE_API_PREFIXES.some((prefix) => event.url.pathname.startsWith(prefix))) {
		return resolve(event);
	}

	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = handleBetterAuth;
