<script lang="ts">
	type ChainHealth = {
		ok: boolean;
		totalEntries: number;
		verifiedEntries: number;
		lastHash: string | null;
		issues: string[];
		graceWindow?: {
			active: boolean;
			unresolvedCycles: number;
			elapsedMs: number;
			dampeningMs: number;
			thresholdCycles: number;
		};
	};

	let { health = null }: { health?: ChainHealth | null } = $props();

	let loading = $state(true);

	const shortHash = (value: string | null) =>
		value ? `${value.slice(0, 12)}...${value.slice(-8)}` : 'No entries yet';

	const graceWindowLabel = (health: ChainHealth) => {
		const grace = health.graceWindow;
		if (!grace?.active) return '';
		const seconds = (grace.elapsedMs / 1000).toFixed(1);
		return `Stabilizing ${seconds}s | cycle ${grace.unresolvedCycles}`;
	};

	$effect(() => {
		loading = !health;
	});
</script>

<section class="hud-card" aria-live="polite">
	<div class="hud-head">
		<h2>Chain Health</h2>
		<span
			class:healthy={health?.ok && !health?.graceWindow?.active}
			class:grace={health?.ok && Boolean(health?.graceWindow?.active)}
			class="status-pill"
			class:compromised={health && !health.ok}
		>
			{#if loading}
				Syncing
			{:else if health?.ok && health?.graceWindow?.active}
				Grace Window
			{:else if health?.ok}
				Verified
			{:else}
				Tamper Alert
			{/if}
		</span>
	</div>

	{#if loading || !health}
		<p class="muted">Initializing ledger telemetry...</p>
	{:else}
		<div class="metrics">
			<div>
				<span class="label">Entries</span>
				<strong>{health.totalEntries}</strong>
			</div>
			<div>
				<span class="label">Verified</span>
				<strong>{health.verifiedEntries}</strong>
			</div>
		</div>
		<p class="hash">Last hash: {shortHash(health.lastHash)}</p>

		{#if health.graceWindow?.active}
			<p class="grace-note">{graceWindowLabel(health)}</p>
		{/if}

		{#if health.issues.length > 0}
			<ul class="issues">
				{#each health.issues as issue}
					<li>{issue}</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>

<style>
	.hud-card {
		background: linear-gradient(145deg, rgba(6, 17, 31, 0.95), rgba(15, 38, 58, 0.92));
		border: 1px solid rgba(119, 186, 255, 0.25);
		border-radius: 16px;
		padding: 1rem;
		box-shadow: 0 14px 36px rgba(2, 8, 15, 0.45);
		backdrop-filter: blur(10px);
	}

	.hud-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.85rem;
	}

	h2 {
		margin: 0;
		font-size: 1rem;
		font-family: 'Space Grotesk', 'Segoe UI', sans-serif;
		letter-spacing: 0.02em;
	}

	.status-pill {
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		background: rgba(255, 191, 71, 0.18);
		border: 1px solid rgba(255, 191, 71, 0.5);
	}

	.status-pill.healthy {
		background: rgba(46, 214, 158, 0.18);
		border-color: rgba(46, 214, 158, 0.6);
	}

	.status-pill.grace {
		background: rgba(255, 191, 71, 0.22);
		border-color: rgba(255, 191, 71, 0.75);
	}

	.status-pill.compromised {
		background: rgba(255, 88, 88, 0.18);
		border-color: rgba(255, 88, 88, 0.6);
	}

	.metrics {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.8rem;
		margin-bottom: 0.75rem;
	}

	.metrics > div {
		background: rgba(174, 223, 255, 0.06);
		border: 1px solid rgba(174, 223, 255, 0.14);
		border-radius: 10px;
		padding: 0.7rem;
	}

	.label {
		display: block;
		font-size: 0.72rem;
		opacity: 0.78;
		margin-bottom: 0.25rem;
	}

	strong {
		font-size: 1.05rem;
		font-family: 'IBM Plex Mono', Consolas, monospace;
	}

	.hash {
		margin: 0;
		font-size: 0.8rem;
		opacity: 0.86;
		word-break: break-all;
	}

	.grace-note {
		margin: 0.5rem 0 0;
		font-size: 0.78rem;
		color: #ffdca0;
	}

	.issues {
		margin: 0.8rem 0 0;
		padding-left: 1rem;
		font-size: 0.78rem;
		color: #ffb0b0;
	}

	.muted {
		margin: 0;
		font-size: 0.84rem;
		opacity: 0.8;
	}
</style>
