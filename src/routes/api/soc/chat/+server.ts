import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runSocNaturalLanguageCommand } from '$lib/server/autonomous-soc';

type SocChatRequest = {
    prompt?: string;
};

export const POST: RequestHandler = async ({ request }) => {
    const payload = (await request.json().catch(() => ({}))) as SocChatRequest;
    const prompt = payload.prompt?.trim();

    if (!prompt) {
        return json({ error: 'prompt is required' }, { status: 400 });
    }

    const result = await runSocNaturalLanguageCommand(prompt);
    return json({ result }, { status: 200 });
};
