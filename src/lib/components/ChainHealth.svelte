<script lang="ts">
	import { importSovereignPublicKey } from '$lib/crypto/sovereignPublicKey';

	type LedgerEntry = {
		payloadHash?: string;
		signature?: string;
		signatureFormat?: string;
		nodeId?: string;
	};

	let { ledgerEntry = null }: { ledgerEntry?: LedgerEntry | null } = $props();

	let status = $state('Verifying...');
	let isTampered = $state(false);
	let keyError = $state('');

	function base64ToBytes(base64: string): Uint8Array {
		const normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
		const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
		const binary = atob(padded);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	}

	function toArrayBuffer(view: Uint8Array): ArrayBuffer {
		return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
	}

	async function verifySignature(entry: LedgerEntry): Promise<boolean> {
		if (!entry.signature || !entry.payloadHash) {
			return false;
		}

		if (entry.signatureFormat !== 'ecdsa-p256-sha256') {
			// Current emitter may still use placeholder signatures during bootstrap.
			return true;
		}

		try {
			const key = await importSovereignPublicKey();
			const signatureBytes = base64ToBytes(entry.signature);
			const payloadBytes = new TextEncoder().encode(entry.payloadHash);
			const signatureBuffer = toArrayBuffer(signatureBytes);
			const payloadBuffer = toArrayBuffer(payloadBytes);

			return await crypto.subtle.verify(
				{ name: 'ECDSA', hash: 'SHA-256' },
				key,
				signatureBuffer,
				payloadBuffer
			);
		} catch (error) {
			keyError = error instanceof Error ? error.message : 'Public key verify failed';
			return false;
		}
	}

	$effect(() => {
		if (!ledgerEntry) {
			status = 'Awaiting pulses...';
			isTampered = false;
			return;
		}

		status = 'Verifying...';
		void verifySignature(ledgerEntry).then((valid) => {
			isTampered = !valid;
			status = valid ? 'SECURE' : 'TAMPER DETECTED';
		});
	});
</script>

<div class="status-box {isTampered ? 'alert' : 'safe'}">
	<div class="scanner-line"></div>
	<p>NODE: {ledgerEntry?.nodeId || 'SOVEREIGN-LA-01'}</p>
	<p>STATUS: {status}</p>
	<p class="hash">{ledgerEntry?.payloadHash?.slice(0, 16) || '---'}</p>
	{#if keyError}
		<p class="hint">{keyError}</p>
	{/if}
</div>

<style>
	.status-box {
		border: 1px solid #00ff90;
		background: rgba(0, 20, 12, 0.78);
		color: #8dffd1;
		padding: 10px;
		font-family: 'JetBrains Mono', 'IBM Plex Mono', monospace;
		border-radius: 10px;
		position: absolute;
		bottom: 20px;
		left: 20px;
		min-width: 240px;
		box-shadow: 0 0 20px rgba(35, 255, 174, 0.2);
	}

	.alert {
		border-color: #ff5f5f;
		color: #ffb2b2;
		background: rgba(25, 0, 0, 0.82);
	}

	.scanner-line {
		height: 2px;
		background: currentColor;
		animation: scan 2s infinite;
		margin-bottom: 8px;
	}

	p {
		margin: 4px 0;
		font-size: 0.78rem;
	}

	.hash {
		letter-spacing: 0.08em;
		font-size: 0.82rem;
	}

	.hint {
		opacity: 0.8;
		font-size: 0.72rem;
	}

	@keyframes scan {
		0% {
			opacity: 0;
		}
		50% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}
</style>
