import type { RequestHandler } from './$types';
import Redis from 'ioredis';

export const GET: RequestHandler = async () => {
    const encoder = new TextEncoder();
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    let closed = false;

    const cleanup = async () => {
        if (closed) return;
        closed = true;
        try {
            await redis.unsubscribe('biometric-stream');
        } finally {
            redis.removeAllListeners('message');
            redis.disconnect();
        }
    };

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const safeEnqueue = (chunk: Uint8Array) => {
                if (!closed) {
                    try {
                        controller.enqueue(chunk);
                    } catch (err) {
                        closed = true;
                    }
                }
            };
            const send = (event: string, data: unknown) => {
                safeEnqueue(encoder.encode(`event: ${event}\n`));
                safeEnqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            };

            void redis.subscribe('biometric-stream').then(() => {
                send('ready', { status: 'subscribed' });
            });

            redis.on('message', (_channel, message) => {
                if (closed) return;
                try {
                    send('pulse', JSON.parse(message));
                } catch {
                    send('pulse', { raw: message });
                }
            });
        },
        async cancel() {
            await cleanup();
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive'
        }
    });
};
