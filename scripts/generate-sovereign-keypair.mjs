import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const rootDir = resolve(process.cwd());
const privateKeyPath = resolve(rootDir, 'keys', 'sovereign_private.pem');
const rootPublicKeyPath = resolve(rootDir, 'sovereign_public.pem');
const staticPublicKeyPath = resolve(rootDir, 'static', 'keys', 'sovereign_public.pem');
const staticRootPublicKeyPath = resolve(rootDir, 'static', 'sovereign_public.pem');
const force = process.argv.includes('--force');
const privateKeyExists = existsSync(privateKeyPath);
const rootPublicKeyExists = existsSync(rootPublicKeyPath);
const staticPublicKeyExists = existsSync(staticPublicKeyPath);
const staticRootPublicKeyExists = existsSync(staticRootPublicKeyPath);

if (
    !force &&
    privateKeyExists &&
    rootPublicKeyExists &&
    staticPublicKeyExists &&
    staticRootPublicKeyExists
) {
    console.log('Key files already exist. Use --force to regenerate.');
    console.log(`Private: ${privateKeyPath}`);
    console.log(`Public (root): ${rootPublicKeyPath}`);
    console.log(`Public (static/keys): ${staticPublicKeyPath}`);
    console.log(`Public (static root): ${staticRootPublicKeyPath}`);
    process.exit(0);
}

mkdirSync(dirname(privateKeyPath), { recursive: true });
mkdirSync(dirname(staticPublicKeyPath), { recursive: true });
mkdirSync(dirname(staticRootPublicKeyPath), { recursive: true });

const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
    },
    publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
    }
});

writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
writeFileSync(rootPublicKeyPath, publicKey, { mode: 0o644 });
writeFileSync(staticPublicKeyPath, publicKey, { mode: 0o644 });
writeFileSync(staticRootPublicKeyPath, publicKey, { mode: 0o644 });

console.log('Sovereign keypair generated.');
console.log(`Private key: ${privateKeyPath}`);
console.log(`Public key (root): ${rootPublicKeyPath}`);
console.log(`Public key (static/keys): ${staticPublicKeyPath}`);
console.log(`Public key (static root): ${staticRootPublicKeyPath}`);
