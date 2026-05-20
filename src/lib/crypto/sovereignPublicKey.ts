const PUBLIC_KEY_PATHS = ['/sovereign_public.pem', '/keys/sovereign_public.pem'];
let cachedPem: string | null = null;
let cachedKey: CryptoKey | null = null;

function pemToArrayBuffer(pem: string): ArrayBuffer {
    const base64 = pem
        .replace('-----BEGIN PUBLIC KEY-----', '')
        .replace('-----END PUBLIC KEY-----', '')
        .replace(/\s+/g, '');

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes.buffer;
}

export async function getSovereignPublicKeyPem(): Promise<string> {
    if (cachedPem) {
        return cachedPem;
    }

    for (const path of PUBLIC_KEY_PATHS) {
        const response = await fetch(path, { cache: 'no-store' });
        if (!response.ok) {
            continue;
        }

        cachedPem = await response.text();
        return cachedPem;
    }

    throw new Error(`Failed to load public key from ${PUBLIC_KEY_PATHS.join(' or ')}`);
}

export async function importSovereignPublicKey(): Promise<CryptoKey> {
    if (cachedKey) {
        return cachedKey;
    }

    const pem = await getSovereignPublicKeyPem();
    const keyBuffer = pemToArrayBuffer(pem);

    cachedKey = await crypto.subtle.importKey(
        'spki',
        keyBuffer,
        {
            name: 'ECDSA',
            namedCurve: 'P-256'
        },
        true,
        ['verify']
    );

    return cachedKey;
}
