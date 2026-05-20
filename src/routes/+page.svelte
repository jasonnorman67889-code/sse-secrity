<script lang="ts">
	import { onMount } from 'svelte';
	import ChainHealth from '$lib/components/ChainHealth.svelte';
	import ChainHealthHud from '$lib/components/ChainHealthHud.svelte';
	import { latLongToVector3 } from '$lib/utils/geo';

	type ChainHealthSnapshot = {
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

	type FusionReason = {
		key: string;
		label: string;
		points: number;
		detail: string;
	};

	type FusionSnapshot = {
		modelVersion: string;
		score: number;
		threshold: number;
		summary: string;
		reasons: FusionReason[];
		features: {
			bypassCount: number;
			newDevice: boolean;
			firstSeenDevice: boolean;
			impossibleTravel: boolean;
			sequenceMinutes: number;
		};
	};

	type FinancialSequenceSnapshot = {
		campaignId?: string | null;
		delivery: boolean;
		entry: boolean;
		takeover: boolean;
		monetization: boolean;
		sequenceDetected: boolean;
		eventWindowMinutes?: number;
	};

	type MetaSentinelSnapshot = {
		trustScore: number;
		trustDelta: number;
		formula: string;
		behavioralIntegrity?: number;
		fraudIndicators?: number;
		propagationRisk?: number;
		forecast?: {
			nextLikelyStep: string;
			confidence: number;
		};
		adaptivePolicy?: {
			trustThreshold: number;
			refined: boolean;
			baselineMs: number;
			averageContainmentMs: number;
			lastRefinedAt: string | null;
		};
		institutionalMemory?: {
			pattern: string | null;
			hardeningTargets: string[];
		};
		mitigationTriggered: boolean;
		autonomousPlaybooks: string[];
		readinessMetric?: {
			restoredTrust: number;
			postMitigationTrust: number;
			readinessPercent: number;
		};
	};

	type ValidationSnapshot = {
		ruleId: string;
		simulatedClick: boolean;
		identityRiskScore: number;
		identityRiskElevated: boolean;
		triggered: boolean;
	};

	type SimulationSnapshot = {
		mode: 'synthetic';
		arcState: 'idle' | 'amber' | 'red' | 'shield';
		detectionZones: string[];
		timeToContainmentMs: number | null;
	};

	type Replay441TimelineStep = {
		stepId: string;
		label: string;
		phase: string;
		nodeId: string;
		timestamp: string;
		trustScore: number;
		arcState: 'amber' | 'red' | 'shield';
	};

	type Replay441Snapshot = {
		replayId: number;
		campaignId: string;
		telemetry_only?: boolean;
		timeline: Replay441TimelineStep[];
		bottleneckStep: string;
		bottleneckReason: string;
		timeToContainmentMs: number;
		continuity?: {
			entityIsolation?: string;
			globalStrategicEquilibrium?: string;
			equilibriumScore?: number;
		};
	};

	type SocChatSnapshot = {
		prompt: string;
		summary: string;
		suggestedAction: string;
		users?: string[];
		graph?: {
			userId: string;
			blastRadius: number;
			finding: string;
		};
	};

	type PlaneSignalSnapshot = {
		plane: 'email' | 'login' | 'bank' | 'card';
		label: string;
		signal: string;
		campaignId?: string | null;
	};

	type PulseEvent = {
		action?: string;
		riskScore?: number;
		payloadHash?: string;
		signature?: string;
		signatureFormat?: string;
		nodeId?: string;
		locationData?: string | { lat?: number; lon?: number; lng?: number } | null;
		chainHealth?: ChainHealthSnapshot;
		attackPath?: {
			sourceNode: string;
			targetNode: string;
			classification: string;
			ruleId: string;
			severity: string;
		};
		spamExposure?: {
			userId: string;
			nodeId: string;
			severity: string;
		};
		fusion?: FusionSnapshot;
		why?: {
			summary?: string;
			reasons?: FusionReason[];
		};
		planeSignal?: PlaneSignalSnapshot;
		financialSequence?: FinancialSequenceSnapshot;
		metaSentinel?: MetaSentinelSnapshot;
		validation?: ValidationSnapshot;
		simulation?: SimulationSnapshot;
		containment?: {
			status: string;
			actions: string[];
		};
	};

	type WarRoomMode = 'threat' | 'financial' | 'containment';

	type ThreatPoint = {
		id: string;
		label: string;
		lat: number;
		lon: number;
		severity: 'low' | 'medium' | 'high';
	};

	const LA_LAT = 34.0522;
	const LA_LON = -118.2437;
	const LDN_LAT = 51.5074;
	const LDN_LON = -0.1278;
	const GLOBE_RADIUS = 5;

	const [laX, laY, laZ] = latLongToVector3(LA_LAT, LA_LON, GLOBE_RADIUS);
	const [ldnX, ldnY, ldnZ] = latLongToVector3(LDN_LAT, LDN_LON, GLOBE_RADIUS);

	const nodeCoordinates: Record<string, { lat: number; lon: number }> = {
		'Node-LA-01': { lat: LA_LAT, lon: LA_LON },
		'Node-LDN-01': { lat: LDN_LAT, lon: LDN_LON },
		'Node-SGP-01': { lat: 1.3521, lon: 103.8198 },
		'Node-TYO-01': { lat: 35.6895, lon: 139.6917 },
		'Node-FRA-01': { lat: 50.1109, lon: 8.6821 },
		'Node-SAO-01': { lat: -23.5505, lon: -46.6333 },
		'SOVEREIGN-LA-01': { lat: LA_LAT, lon: LA_LON },
		'SOVEREIGN-LDN-01': { lat: LDN_LAT, lon: LDN_LON }
	};

	type RiskPath = {
		id: string;
		sourceNode: string;
		targetNode: string;
		classification: string;
		createdAt: number;
	};

	type SpamExposure = {
		id: string;
		userId: string;
		nodeId: string;
		createdAt: number;
	};

	type FinancialPulse = {
		id: string;
		nodeId: string;
		plane: 'email' | 'login' | 'bank' | 'card';
		label: string;
		trustScore: number;
		createdAt: number;
	};

	type SimulationArc = {
		id: string;
		sourceNode: string;
		targetNode: string;
		state: 'idle' | 'amber' | 'red' | 'shield';
		createdAt: number;
	};

	type DetectionZone = {
		id: string;
		nodeId: string;
		state: 'idle' | 'amber' | 'red' | 'shield';
		createdAt: number;
	};

	const projectToStage = (x: number, y: number, radius: number) => {
		const spread = 34;
		const left = 50 + (x / radius) * spread;
		const top = 50 - (y / radius) * spread;
		return {
			left: `${Math.max(8, Math.min(92, left)).toFixed(2)}%`,
			top: `${Math.max(8, Math.min(92, top)).toFixed(2)}%`
		};
	};

	let latestLedgerEntry = $state<PulseEvent | null>(null);
	let latestChainHealth = $state<ChainHealthSnapshot | null>(null);
	let latestFusion = $state<FusionSnapshot | null>(null);
	let activeMode = $state<WarRoomMode>('threat');
	let latestMetaSentinel = $state<MetaSentinelSnapshot | null>(null);
	let latestValidation = $state<ValidationSnapshot | null>(null);
	let latestSimulation = $state<SimulationSnapshot | null>(null);
	let latestFinancialSequence = $state<FinancialSequenceSnapshot | null>(null);
	let containmentActions = $state<string[]>([]);
	let threatPoints = $state<ThreatPoint[]>([]);
	let riskPaths = $state<RiskPath[]>([]);
	let spamExposures = $state<SpamExposure[]>([]);
	let financialPulses = $state<FinancialPulse[]>([]);
	let simulationArcs = $state<SimulationArc[]>([]);
	let detectionZones = $state<DetectionZone[]>([]);
	let replay441 = $state<Replay441Snapshot | null>(null);
	let replay118 = $state<Replay441Snapshot | null>(null);
	let replayCursorIndex = $state(0);
	let replayScenarioId = $state<'441' | '118'>('441');
	const activeReplay = $derived(replayScenarioId === '118' ? replay118 : replay441);
	let replayLoading = $state(false);
	let replayError = $state<string | null>(null);
	let socPrompt = $state('Isolate all users showing impossible travel in the last 2 hours');
	let socBusy = $state(false);
	let socError = $state<string | null>(null);
	let socResult = $state<SocChatSnapshot | null>(null);
	let renderClock = $state(Date.now());
	let laMarker = $state(projectToStage(laX, laY, GLOBE_RADIUS));
	let ldnMarker = $state(projectToStage(ldnX, ldnY, GLOBE_RADIUS));

	function toStageMarker(nodeId: string) {
		const point = nodeCoordinates[nodeId];
		if (!point) {
			return projectToStage(laX, laY, GLOBE_RADIUS);
		}
		const [x, y] = latLongToVector3(point.lat, point.lon, GLOBE_RADIUS);
		return projectToStage(x, y, GLOBE_RADIUS);
	}

	function toNumberPercent(value: string): number {
		return Number(value.replace('%', ''));
	}

	function riskArcStyle(path: { sourceNode: string; targetNode: string }) {
		const source = toStageMarker(path.sourceNode);
		const target = toStageMarker(path.targetNode);
		const x1 = toNumberPercent(source.left);
		const y1 = toNumberPercent(source.top);
		const x2 = toNumberPercent(target.left);
		const y2 = toNumberPercent(target.top);
		const dx = x2 - x1;
		const dy = y2 - y1;
		const distance = Math.hypot(dx, dy);
		const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

		return `left: ${source.left}; top: ${source.top}; width: ${distance.toFixed(2)}%; transform: rotate(${angle.toFixed(2)}deg);`;
	}

	function isSeveredArc(path: RiskPath) {
		return renderClock - path.createdAt >= 45_000;
	}

	function isStaleSimulationArc(arc: SimulationArc) {
		return renderClock - arc.createdAt >= 60_000;
	}

	function simulationArcClass(state: SimulationArc['state']) {
		switch (state) {
			case 'amber':
				return 'amber';
			case 'red':
				return 'red';
			case 'shield':
				return 'shield';
			default:
				return 'idle';
		}
	}

	function detectionZoneClass(state: DetectionZone['state']) {
		switch (state) {
			case 'amber':
				return 'amber';
			case 'red':
				return 'red';
			case 'shield':
				return 'shield';
			default:
				return 'idle';
		}
	}

	function formatDuration(ms: number | null | undefined) {
		if (typeof ms !== 'number' || Number.isNaN(ms)) {
			return 'n/a';
		}
		if (ms < 1000) {
			return `${ms} ms`;
		}
		return `${(ms / 1000).toFixed(1)} s`;
	}

	async function runReplay441() {
		replayLoading = true;
		replayError = null;
		try {
			const response = await fetch('/api/risk/reality-replay/441', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});
			if (!response.ok) {
				throw new Error(`Replay request failed with ${response.status}`);
			}
			const payload = (await response.json()) as Replay441Snapshot;
			replay441 = payload;
			replayScenarioId = '441';
			replayCursorIndex = payload.timeline.length > 0 ? payload.timeline.length - 1 : 0;
			activeMode = 'containment';
		} catch (error) {
			replayError = error instanceof Error ? error.message : 'Replay failed.';
		} finally {
			replayLoading = false;
		}
	}

	async function runReplay118() {
		replayLoading = true;
		replayError = null;
		try {
			const response = await fetch('/api/risk/reality-replay/118', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});
			if (!response.ok) {
				throw new Error(`Replay request failed with ${response.status}`);
			}
			const payload = (await response.json()) as Replay441Snapshot;
			replay118 = payload;
			replayScenarioId = '118';
			replayCursorIndex = payload.timeline.length > 0 ? payload.timeline.length - 1 : 0;
			activeMode = 'containment';
		} catch (error) {
			replayError = error instanceof Error ? error.message : 'Replay failed.';
		} finally {
			replayLoading = false;
		}
	}

	async function runSocPrompt() {
		if (!socPrompt.trim()) {
			socError = 'Enter a SOC command.';
			return;
		}

		socBusy = true;
		socError = null;
		try {
			const response = await fetch('/api/soc/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ prompt: socPrompt })
			});

			if (!response.ok) {
				throw new Error(`SOC command failed with ${response.status}`);
			}

			const payload = (await response.json()) as { result: SocChatSnapshot };
			socResult = payload.result;
		} catch (error) {
			socError = error instanceof Error ? error.message : 'SOC command failed.';
		} finally {
			socBusy = false;
		}
	}

	function reasonWeightClass(reason: FusionReason) {
		switch (reason.key) {
			case 'impossible_travel':
			case 'auth_bypass':
				return 'critical';
			case 'new_device':
			case 'first_seen_device':
				return 'warning';
			case 'cross_node_pivot':
				return 'pivot';
			case 'window_decay':
				return 'decay';
			default:
				return 'baseline';
		}
	}

	async function hydrateChainHealth() {
		try {
			const response = await fetch('/api/ledger/health');
			if (!response.ok) {
				return;
			}
			latestChainHealth = (await response.json()) as ChainHealthSnapshot;
		} catch {
			// Live stream events will continue to update chain health.
		}
	}

	async function hydrateThreatIntel() {
		try {
			const response = await fetch('/api/threat-intel');
			if (!response.ok) {
				return;
			}
			const payload = (await response.json()) as { points?: ThreatPoint[] };
			threatPoints = Array.isArray(payload.points) ? payload.points : [];
		} catch {
			// Threat overlay is best-effort and should not block core telemetry.
		}
	}

	function resolvePulseCoordinates(event: PulseEvent) {
		let lat = LA_LAT;
		let lon = LA_LON;

		if (event.nodeId && nodeCoordinates[event.nodeId]) {
			lat = nodeCoordinates[event.nodeId].lat;
			lon = nodeCoordinates[event.nodeId].lon;
		}

		if (event.locationData) {
			let parsed: { lat?: number; lon?: number; lng?: number };
			if (typeof event.locationData === 'string') {
				try {
					parsed = JSON.parse(event.locationData) as {
						lat?: number;
						lon?: number;
						lng?: number;
					};
				} catch {
					parsed = {};
				}
			} else {
				parsed = event.locationData;
			}

			if (typeof parsed.lat === 'number') {
				lat = parsed.lat;
			}
			if (typeof parsed.lon === 'number') {
				lon = parsed.lon;
			} else if (typeof parsed.lng === 'number') {
				lon = parsed.lng;
			}
		}

		return { lat, lon };
	}

	onMount(() => {
		void hydrateChainHealth();
		void hydrateThreatIntel();
		const threatRefresh = setInterval(() => void hydrateThreatIntel(), 60_000);
		let queuedPulse: PulseEvent | null = null;
		const maxUiFps = 60;
		const uiTickMs = Math.round(1000 / maxUiFps);

		const stream = new EventSource('/api/stream/biometric');
		const pulseDrain = setInterval(() => {
			renderClock = Date.now();
			const ttl = renderClock - 90_000;
			riskPaths = riskPaths.filter((path) => path.createdAt >= ttl);
			spamExposures = spamExposures.filter((item) => item.createdAt >= ttl);
			financialPulses = financialPulses.filter((item) => item.createdAt >= ttl);
			simulationArcs = simulationArcs.filter((arc) => !isStaleSimulationArc(arc));
			detectionZones = detectionZones.filter((zone) => renderClock - zone.createdAt < 90_000);

			if (!queuedPulse) {
				return;
			}

			const pulse = queuedPulse;
			queuedPulse = null;

			latestLedgerEntry = pulse;
			if (pulse.chainHealth) {
				latestChainHealth = pulse.chainHealth;
			}
			if (pulse.fusion) {
				latestFusion = pulse.fusion;
			}
			if (pulse.metaSentinel) {
				latestMetaSentinel = pulse.metaSentinel;
				if (pulse.metaSentinel.mitigationTriggered) {
					activeMode = 'containment';
				}
			}
			if (pulse.validation) {
				latestValidation = pulse.validation;
			}
			if (pulse.simulation) {
				latestSimulation = pulse.simulation;
				const now = Date.now();
				const zones = pulse.simulation.detectionZones ?? [];
				detectionZones = [
					...detectionZones,
					...zones.map((nodeId) => ({
						id: `${nodeId}-${now}`,
						nodeId,
						state: pulse.simulation?.arcState ?? 'idle',
						createdAt: now
					}))
				].slice(-20);

				if (pulse.nodeId && zones.length > 0) {
					simulationArcs = [
						...simulationArcs,
						...zones
							.filter((targetNode) => targetNode !== pulse.nodeId)
							.map((targetNode) => ({
								id: `sim-${pulse.nodeId}-${targetNode}-${now}`,
								sourceNode: pulse.nodeId as string,
								targetNode,
								state: pulse.simulation?.arcState ?? 'idle',
								createdAt: now
							}))
					].slice(-24);
				}
			}
			if (pulse.financialSequence) {
				latestFinancialSequence = pulse.financialSequence;
			}
			if (pulse.containment?.actions?.length) {
				containmentActions = pulse.containment.actions;
			}
			if (pulse.planeSignal && pulse.nodeId && pulse.metaSentinel) {
				financialPulses = [
					...financialPulses,
					{
						id: `${pulse.planeSignal.plane}-${pulse.nodeId}-${Date.now()}`,
						nodeId: pulse.nodeId,
						plane: pulse.planeSignal.plane,
						label: pulse.planeSignal.label,
						trustScore: pulse.metaSentinel.trustScore,
						createdAt: Date.now()
					}
				].slice(-16);
			}

			if (pulse.attackPath) {
				riskPaths = [
					...riskPaths,
					{
						id: `${pulse.attackPath.ruleId}-${Date.now()}`,
						sourceNode: pulse.attackPath.sourceNode,
						targetNode: pulse.attackPath.targetNode,
						classification: pulse.attackPath.classification,
						createdAt: Date.now()
					}
				].slice(-6);
			}

			if (pulse.spamExposure) {
				spamExposures = [
					...spamExposures,
					{
						id: `${pulse.spamExposure.userId}-${Date.now()}`,
						userId: pulse.spamExposure.userId,
						nodeId: pulse.spamExposure.nodeId,
						createdAt: Date.now()
					}
				].slice(-10);
			}

			const { lat, lon } = resolvePulseCoordinates(pulse);
			const [x, y] = latLongToVector3(lat, lon, GLOBE_RADIUS);
			if (pulse.nodeId === 'SOVEREIGN-LDN-01') {
				ldnMarker = projectToStage(x, y, GLOBE_RADIUS);
			} else {
				laMarker = projectToStage(x, y, GLOBE_RADIUS);
			}
		}, uiTickMs);

		stream.addEventListener('pulse', (rawEvent) => {
			const message = rawEvent as MessageEvent<string>;
			let pulse: PulseEvent;
			try {
				pulse = JSON.parse(message.data) as PulseEvent;
			} catch {
				return;
			}

			// Keep the latest pulse and render at a capped cadence for smoother HUD updates.
			queuedPulse = pulse;
		});

		return () => {
			clearInterval(threatRefresh);
			clearInterval(pulseDrain);
			stream.close();
		};
	});
</script>

<main class="control-surface">
	<section class="globe-panel">
		<div class="panel-head">
			<h1>Sovereign Financial-Cyber Defense Grid</h1>
			<p>Executive War-Room Globe with cross-plane fraud sequence intelligence.</p>
		</div>

		<div class="mode-switch" role="tablist" aria-label="Executive war-room modes">
			<button
				type="button"
				class:active={activeMode === 'threat'}
				onclick={() => (activeMode = 'threat')}
			>
				Threat
			</button>
			<button
				type="button"
				class:active={activeMode === 'financial'}
				onclick={() => (activeMode = 'financial')}
			>
				Financial Exposure
			</button>
			<button
				type="button"
				class:active={activeMode === 'containment'}
				onclick={() => (activeMode = 'containment')}
			>
				Containment
			</button>
		</div>

		<div
			class="globe-stage"
			aria-label="3D globe visualization area"
			style={`--pulse-left: ${laMarker.left}; --pulse-top: ${laMarker.top}; --ldn-left: ${ldnMarker.left}; --ldn-top: ${ldnMarker.top};`}
		>
			<div class="orbital-grid"></div>
			<div class="globe-core"></div>
			<div class="pulse pulse-a"></div>
			<div class="pulse pulse-b"></div>
			<div class="marker marker-a"></div>
			<div class="marker marker-b"></div>
			{#if activeMode === 'threat'}
				{#each threatPoints as threat (threat.id)}
					{@const vec = latLongToVector3(threat.lat, threat.lon, GLOBE_RADIUS)}
					{@const marker = projectToStage(vec[0], vec[1], GLOBE_RADIUS)}
					<div
						class={`threat-marker ${threat.severity}`}
						style={`left: ${marker.left}; top: ${marker.top};`}
						title={`${threat.label} (${threat.severity})`}
					></div>
				{/each}
				{#each riskPaths as path (path.id)}
					<div
						class={`risk-arc ${isSeveredArc(path) ? 'severed' : ''}`}
						style={riskArcStyle(path)}
						title={path.classification}
					></div>
				{/each}
			{/if}

			{#if activeMode === 'financial'}
				<div class="simulation-layer-label">Simulation Arcs</div>
				{#each simulationArcs as arc (arc.id)}
					<div
						class={`simulation-arc ${simulationArcClass(arc.state)} ${isStaleSimulationArc(arc) ? 'severed' : ''}`}
						style={riskArcStyle(arc)}
						title={`Simulation ${arc.state}: ${arc.sourceNode} -> ${arc.targetNode}`}
					>
						{#if arc.state === 'shield'}
							{#each [...Array(10).keys()] as index (index)}
								<span class="shield-pixel" style={`--i:${index};`}></span>
							{/each}
						{/if}
					</div>
				{/each}
				<div class="simulation-layer-label zones">Detection Zones</div>
				{#each detectionZones as zone (zone.id)}
					{@const marker = toStageMarker(zone.nodeId)}
					<div
						class={`detection-zone ${detectionZoneClass(zone.state)}`}
						style={`left: ${marker.left}; top: ${marker.top};`}
						title={`Detection zone ${zone.nodeId} (${zone.state})`}
					></div>
				{/each}
				{#each spamExposures as exposure (exposure.id)}
					{@const marker = toStageMarker(exposure.nodeId)}
					<div
						class="spam-user-marker"
						style={`left: ${marker.left}; top: ${marker.top};`}
						title={`High exposure user ${exposure.userId}`}
					></div>
				{/each}
				{#each financialPulses as pulse (pulse.id)}
					{@const marker = toStageMarker(pulse.nodeId)}
					<div
						class={`financial-plane-marker ${pulse.plane}`}
						style={`left: ${marker.left}; top: ${marker.top};`}
						title={`${pulse.label} | trust ${pulse.trustScore}`}
					></div>
				{/each}
			{/if}

			{#if activeMode === 'containment'}
				<div class="simulation-layer-label">Simulation Arcs</div>
				{#each simulationArcs as arc (arc.id)}
					<div
						class={`simulation-arc ${simulationArcClass(arc.state)} ${isStaleSimulationArc(arc) ? 'severed' : ''}`}
						style={riskArcStyle(arc)}
						title={`Simulation ${arc.state}: ${arc.sourceNode} -> ${arc.targetNode}`}
					>
						{#if arc.state === 'shield'}
							{#each [...Array(10).keys()] as index (index)}
								<span class="shield-pixel" style={`--i:${index};`}></span>
							{/each}
						{/if}
					</div>
				{/each}
				<div class="simulation-layer-label zones">Detection Zones</div>
				{#each detectionZones as zone (zone.id)}
					{@const marker = toStageMarker(zone.nodeId)}
					<div
						class={`detection-zone ${detectionZoneClass(zone.state)}`}
						style={`left: ${marker.left}; top: ${marker.top};`}
						title={`Detection zone ${zone.nodeId} (${zone.state})`}
					></div>
				{/each}
				{#each riskPaths as path (path.id)}
					<div
						class={`risk-arc containment ${isSeveredArc(path) ? 'severed' : ''}`}
						style={riskArcStyle(path)}
						title={path.classification}
					></div>
				{/each}
				{#each financialPulses as pulse (pulse.id)}
					{@const marker = toStageMarker(pulse.nodeId)}
					<div
						class="containment-marker"
						style={`left: ${marker.left}; top: ${marker.top};`}
						title={`Containment active for ${pulse.nodeId}`}
					></div>
				{/each}
			{/if}
			<ChainHealth ledgerEntry={latestLedgerEntry} />
			<p class="stage-label">Executive War-Room Globe ({activeMode})</p>
		</div>
	</section>

	<aside class="hud-panel">
		<ChainHealthHud health={latestChainHealth} />
		<div class="meta-card">
			<h2>AI Meta-Sentinel</h2>
			{#if latestMetaSentinel}
				<p class="meta-trust">trust score: {latestMetaSentinel.trustScore}</p>
				<p>delta: {latestMetaSentinel.trustDelta}</p>
				{#if typeof latestMetaSentinel.behavioralIntegrity === 'number'}
					<p>
						integrity={latestMetaSentinel.behavioralIntegrity} / fraud={latestMetaSentinel.fraudIndicators ??
							'n/a'} / propagation={latestMetaSentinel.propagationRisk ?? 'n/a'}
					</p>
				{/if}
				<p>
					forecast: {latestMetaSentinel.forecast?.nextLikelyStep ?? 'n/a'}
					({Math.round((latestMetaSentinel.forecast?.confidence ?? 0) * 100)}%)
				</p>
				<p class="meta-formula">{latestMetaSentinel.formula}</p>
				{#if latestMetaSentinel.readinessMetric}
					<p>readiness: {latestMetaSentinel.readinessMetric.readinessPercent}%</p>
					<p>
						restored trust: +{latestMetaSentinel.readinessMetric.restoredTrust} (post {latestMetaSentinel
							.readinessMetric.postMitigationTrust})
					</p>
				{/if}
				{#if latestMetaSentinel.adaptivePolicy}
					<p>
						adaptive threshold: {latestMetaSentinel.adaptivePolicy.trustThreshold}
						({latestMetaSentinel.adaptivePolicy.refined ? 'refined' : 'stable'})
					</p>
					<p>
						latency baseline: {formatDuration(latestMetaSentinel.adaptivePolicy.baselineMs)} | avg: {formatDuration(
							latestMetaSentinel.adaptivePolicy.averageContainmentMs
						)}
					</p>
				{/if}
				{#if latestMetaSentinel.institutionalMemory?.pattern}
					<p>memory: {latestMetaSentinel.institutionalMemory.pattern}</p>
					<p>
						hardening targets:
						{latestMetaSentinel.institutionalMemory.hardeningTargets.join(', ') || 'none'}
					</p>
				{/if}
			{:else}
				<p class="why-empty">Awaiting financial plane telemetry.</p>
			{/if}
			{#if latestValidation}
				<div class="validation-inline">
					<p>rule: {latestValidation.ruleId}</p>
					<p>
						simulated click={latestValidation.simulatedClick ? 'Y' : 'N'} / identity risk={latestValidation.identityRiskScore}
					</p>
					<p>triggered: {latestValidation.triggered ? 'Y' : 'N'}</p>
				</div>
			{/if}
			{#if latestSimulation}
				<div class="simulation-inline">
					<p>arc state: {latestSimulation.arcState}</p>
					<p>detection zones: {latestSimulation.detectionZones.join(', ') || 'n/a'}</p>
					<p>time to containment: {formatDuration(latestSimulation.timeToContainmentMs)}</p>
				</div>
			{/if}
		</div>
		<div class="why-card">
			<h2>Why Panel</h2>
			{#if latestFusion}
				<p class="why-summary">{latestFusion.summary}</p>
				<div class="confidence-row">
					<span>confidence</span>
					<div class="confidence-bar" aria-label="fusion confidence bar">
						<div class="confidence-fill" style={`width: ${latestFusion.score}%;`}></div>
						<div class="confidence-threshold" style={`left: ${latestFusion.threshold}%;`}></div>
					</div>
					<span>{latestFusion.score}%</span>
				</div>
				<p>
					fusion score: {latestFusion.score} / 100 (threshold {latestFusion.threshold})
				</p>
				{#if latestFusion.features.bypassCount > 0 || latestFusion.features.newDevice}
					<p>
						{latestFusion.features.bypassCount} bypasses +
						{latestFusion.features.newDevice ? '1 new device' : '0 new devices'}
					</p>
				{/if}
				<div class="reason-weight-grid">
					<p class="reason-weight-title">weighted readiness reason codes</p>
					<p>device drift: {latestFusion.features.newDevice ? 18 : 4}</p>
					<p>geo-velocity: {latestFusion.features.impossibleTravel ? 28 : 6}</p>
					<p>auth bypass pressure: {Math.min(30, latestFusion.features.bypassCount * 7)}</p>
				</div>
				{#each latestFusion.reasons as reason (reason.key)}
					<div class={`why-reason ${reasonWeightClass(reason)}`}>
						<span>{reason.label}</span>
						<span class="why-points">{reason.points > 0 ? '+' : ''}{reason.points}</span>
					</div>
				{/each}
			{:else}
				<p class="why-empty">Awaiting correlated fusion event.</p>
			{/if}
		</div>
		<div class="containment-card">
			<h2>Autonomous Recovery</h2>
			{#if containmentActions.length > 0}
				{#each containmentActions as action, index (`${action}-${index}`)}
					<p>{action}</p>
				{/each}
			{:else}
				<p class="why-empty">Containment playbooks idle.</p>
			{/if}
			{#if latestFinancialSequence}
				<p>
					Sequence state: delivery={latestFinancialSequence.delivery ? 'Y' : 'N'} / entry={latestFinancialSequence.entry
						? 'Y'
						: 'N'} / takeover={latestFinancialSequence.takeover ? 'Y' : 'N'} / monetization={latestFinancialSequence.monetization
						? 'Y'
						: 'N'}
				</p>
			{/if}
		</div>
		<div class="replay-card">
			<h2>Replay & Readiness Mesh</h2>
			<div class="replay-buttons">
				<button
					type="button"
					class="replay-button"
					onclick={() => void runReplay441()}
					disabled={replayLoading}
				>
					{replayLoading ? 'Running replay...' : 'Run replay #441'}
				</button>
				<button
					type="button"
					class="replay-button"
					onclick={() => void runReplay118()}
					disabled={replayLoading}
				>
					{replayLoading ? 'Running replay...' : 'Run crisis #118'}
				</button>
			</div>
			{#if replayError}
				<p class="replay-error">{replayError}</p>
			{/if}
			{#if activeReplay}
				<p>
					replay: #{activeReplay.replayId} | telemetry_only={activeReplay.telemetry_only
						? 'Y'
						: 'N'}
				</p>
				<p>campaign: {activeReplay.campaignId}</p>
				<p>bottleneck: {activeReplay.bottleneckStep}</p>
				<p class="meta-formula">{activeReplay.bottleneckReason}</p>
				<p>containment latency: {formatDuration(activeReplay.timeToContainmentMs)}</p>
				{#if activeReplay.continuity}
					<p>
						equilibrium: {activeReplay.continuity.globalStrategicEquilibrium ?? 'n/a'}
						({activeReplay.continuity.equilibriumScore ?? 'n/a'})
					</p>
				{/if}
				<input
					type="range"
					min="0"
					max={Math.max(activeReplay.timeline.length - 1, 0)}
					step="1"
					value={replayCursorIndex}
					oninput={(event) => {
						replayCursorIndex = Number((event.currentTarget as HTMLInputElement).value);
					}}
				/>
				{#if activeReplay.timeline[replayCursorIndex]}
					<p>
						phase: {activeReplay.timeline[replayCursorIndex].phase} | node: {activeReplay.timeline[
							replayCursorIndex
						].nodeId}
					</p>
					<p>
						arc: {activeReplay.timeline[replayCursorIndex].arcState} | trust: {activeReplay
							.timeline[replayCursorIndex].trustScore}
					</p>
					<p>{activeReplay.timeline[replayCursorIndex].label}</p>
				{/if}
			{/if}
		</div>
		<div class="soc-card">
			<h2>Natural Language SOC Console</h2>
			<p class="soc-subtitle">
				Tier 1 triage, Tier 2 graph investigation, Tier 3 response guidance.
			</p>
			<form
				onsubmit={(event) => {
					event.preventDefault();
					void runSocPrompt();
				}}
			>
				<textarea
					rows="3"
					bind:value={socPrompt}
					placeholder="Isolate all users showing impossible travel in the last 2 hours"
				></textarea>
				<button type="submit" class="replay-button" disabled={socBusy}>
					{socBusy ? 'Investigating...' : 'Run SOC command'}
				</button>
			</form>
			{#if socError}
				<p class="replay-error">{socError}</p>
			{/if}
			{#if socResult}
				<p class="soc-answer">{socResult.summary}</p>
				<p>{socResult.suggestedAction}</p>
				{#if socResult.users && socResult.users.length > 0}
					<p>users: {socResult.users.join(', ')}</p>
				{/if}
				{#if socResult.graph}
					<p>
						blast radius ({socResult.graph.userId}): {socResult.graph.blastRadius}
					</p>
					<p class="meta-formula">{socResult.graph.finding}</p>
				{/if}
			{/if}
		</div>
		<div class="vector-card">
			<h2>LA Coordinate Vector</h2>
			<p>lat: {LA_LAT} lon: {LA_LON}</p>
			<p>x: {laX.toFixed(4)} y: {laY.toFixed(4)} z: {laZ.toFixed(4)}</p>
			<h2>London Coordinate Vector</h2>
			<p>node: SOVEREIGN-LDN-01</p>
			<p>lat: {LDN_LAT} lon: {LDN_LON}</p>
			<p>x: {ldnX.toFixed(4)} y: {ldnY.toFixed(4)} z: {ldnZ.toFixed(4)}</p>
		</div>
	</aside>
</main>

<style>
	:global(body) {
		margin: 0;
		min-height: 100vh;
		background:
			radial-gradient(circle at 20% 10%, rgba(78, 148, 216, 0.28), transparent 45%),
			radial-gradient(circle at 80% 88%, rgba(2, 229, 183, 0.16), transparent 35%),
			linear-gradient(155deg, #061017, #0c1c2a 45%, #0b2535);
		color: #eaf6ff;
		font-family: 'Space Grotesk', 'Segoe UI', sans-serif;
	}

	.control-surface {
		display: grid;
		grid-template-columns: 1.4fr minmax(280px, 0.85fr);
		gap: 1rem;
		padding: 1rem;
		max-width: 1300px;
		margin: 0 auto;
		min-height: 100vh;
		box-sizing: border-box;
	}

	.globe-panel {
		background: linear-gradient(170deg, rgba(13, 31, 45, 0.92), rgba(8, 23, 34, 0.86));
		border: 1px solid rgba(156, 213, 255, 0.2);
		border-radius: 18px;
		padding: 1.1rem;
		box-shadow: 0 20px 40px rgba(1, 10, 17, 0.45);
		display: grid;
		grid-template-rows: auto 1fr;
		gap: 1rem;
	}

	.panel-head h1 {
		margin: 0;
		font-size: clamp(1.4rem, 2.1vw, 2rem);
		letter-spacing: 0.03em;
	}

	.panel-head p {
		margin: 0.35rem 0 0;
		opacity: 0.82;
		font-size: 0.92rem;
	}

	.mode-switch {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.mode-switch button {
		border: 1px solid rgba(132, 198, 240, 0.3);
		background: rgba(6, 21, 34, 0.65);
		color: #dff6ff;
		border-radius: 999px;
		padding: 0.35rem 0.8rem;
		font-family: 'IBM Plex Mono', Consolas, monospace;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		cursor: pointer;
	}

	.mode-switch button.active {
		background: rgba(35, 209, 255, 0.18);
		border-color: rgba(131, 236, 255, 0.85);
		box-shadow: 0 0 12px rgba(88, 221, 255, 0.45);
	}

	.globe-stage {
		position: relative;
		border-radius: 14px;
		overflow: hidden;
		background:
			radial-gradient(circle at 50% 50%, rgba(25, 166, 255, 0.3), rgba(6, 18, 29, 0.92) 62%),
			linear-gradient(120deg, rgba(143, 229, 255, 0.06), rgba(1, 8, 17, 0.4));
		border: 1px solid rgba(132, 198, 240, 0.2);
		min-height: 380px;
		display: grid;
		place-items: center;
	}

	.orbital-grid {
		position: absolute;
		inset: 0;
		background-image:
			linear-gradient(rgba(161, 225, 255, 0.06) 1px, transparent 1px),
			linear-gradient(90deg, rgba(161, 225, 255, 0.06) 1px, transparent 1px);
		background-size: 32px 32px;
	}

	.globe-core {
		width: min(58vw, 360px);
		aspect-ratio: 1;
		border-radius: 50%;
		background:
			radial-gradient(
				circle at 30% 30%,
				rgba(166, 245, 255, 0.95),
				rgba(37, 151, 242, 0.72) 46%,
				rgba(3, 54, 88, 0.95) 78%
			),
			conic-gradient(
				from 150deg,
				rgba(111, 246, 230, 0.35),
				rgba(97, 191, 255, 0.18),
				rgba(111, 246, 230, 0.35)
			);
		box-shadow:
			0 0 32px rgba(107, 189, 255, 0.55),
			inset -20px -14px 34px rgba(0, 33, 66, 0.7),
			inset 9px 11px 16px rgba(206, 243, 255, 0.26);
		animation: rotateSphere 16s linear infinite;
	}

	.pulse {
		position: absolute;
		width: 44%;
		aspect-ratio: 1;
		border-radius: 50%;
		border: 1px solid rgba(88, 210, 255, 0.5);
		animation: pulseWave 4.6s ease-out infinite;
	}

	.pulse-b {
		animation-delay: 2.2s;
	}

	.pulse-a {
		width: 18%;
		left: calc(var(--pulse-left) - 9%);
		top: calc(var(--pulse-top) - 9%);
		border-color: rgba(255, 211, 116, 0.65);
	}

	.marker {
		position: absolute;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: #8af5ff;
		box-shadow: 0 0 12px #8af5ff;
	}

	.marker-a {
		top: var(--pulse-top);
		left: var(--pulse-left);
		width: 11px;
		height: 11px;
		background: #ffcb72;
		box-shadow: 0 0 18px #ffcb72;
	}

	.marker-b {
		top: var(--ldn-top);
		left: var(--ldn-left);
		background: #8af5ff;
		box-shadow: 0 0 14px #8af5ff;
	}

	.threat-marker {
		position: absolute;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		background: radial-gradient(circle, #ffd3d3, #ff2a2a 58%, #560000 100%);
		border: 1px solid rgba(255, 120, 120, 0.75);
		box-shadow:
			0 0 10px rgba(255, 56, 56, 0.85),
			0 0 24px rgba(255, 0, 0, 0.42);
		animation: threat-flicker 1.25s ease-in-out infinite;
	}

	.threat-marker.medium {
		animation-duration: 1.5s;
		opacity: 0.88;
	}

	.threat-marker.low {
		animation-duration: 1.8s;
		opacity: 0.75;
	}

	.risk-arc {
		position: absolute;
		height: 2px;
		transform-origin: left center;
		background: linear-gradient(90deg, rgba(255, 85, 85, 0.9), rgba(255, 20, 20, 0.2));
		box-shadow: 0 0 10px rgba(255, 44, 44, 0.8);
		animation: path-pulse 1.2s ease-in-out infinite;
	}

	.risk-arc.containment {
		background: linear-gradient(90deg, rgba(76, 255, 195, 0.92), rgba(24, 255, 135, 0.24));
		box-shadow: 0 0 10px rgba(45, 255, 164, 0.82);
	}

	.risk-arc.severed {
		background: linear-gradient(90deg, rgba(10, 10, 10, 0.92), rgba(4, 4, 4, 0.25));
		box-shadow: 0 0 8px rgba(0, 0, 0, 0.5);
		opacity: 0.78;
	}

	.simulation-layer-label {
		position: absolute;
		top: 0.6rem;
		left: 0.75rem;
		z-index: 5;
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: rgba(255, 201, 122, 0.92);
		font-family: 'IBM Plex Mono', Consolas, monospace;
	}

	.simulation-layer-label.zones {
		top: 1.65rem;
		color: rgba(155, 234, 255, 0.9);
	}

	.simulation-arc {
		position: absolute;
		height: 3px;
		transform-origin: left center;
		animation: path-pulse 1.05s ease-in-out infinite;
		overflow: visible;
	}

	.simulation-arc.idle {
		background: linear-gradient(90deg, rgba(152, 173, 189, 0.8), rgba(152, 173, 189, 0.16));
		box-shadow: 0 0 8px rgba(126, 151, 170, 0.5);
	}

	.simulation-arc.amber {
		background: linear-gradient(90deg, rgba(255, 188, 79, 0.96), rgba(255, 188, 79, 0.22));
		box-shadow: 0 0 12px rgba(255, 180, 59, 0.85);
	}

	.simulation-arc.red {
		background: linear-gradient(90deg, rgba(255, 84, 84, 0.97), rgba(255, 84, 84, 0.2));
		box-shadow: 0 0 13px rgba(255, 69, 69, 0.86);
	}

	.simulation-arc.shield {
		background:
			repeating-linear-gradient(
				90deg,
				rgba(117, 255, 206, 0.94) 0 6px,
				rgba(19, 255, 166, 0.62) 6px 12px
			),
			linear-gradient(90deg, rgba(117, 255, 206, 0.94), rgba(117, 255, 206, 0.2));
		box-shadow: 0 0 14px rgba(92, 255, 198, 0.84);
	}

	.shield-pixel {
		position: absolute;
		left: calc(var(--i) * 10%);
		top: -3px;
		width: 3px;
		height: 3px;
		background: linear-gradient(135deg, #ffffff, #8bd7ff 70%);
		box-shadow: 0 0 6px rgba(168, 230, 255, 0.85);
		animation: shield-shatter 780ms ease-out infinite;
		animation-delay: calc(var(--i) * 45ms);
	}

	.simulation-arc.severed {
		opacity: 0.45;
		animation-duration: 1.8s;
	}

	.detection-zone {
		position: absolute;
		width: 18px;
		height: 18px;
		transform: translate(-50%, -50%);
		border-radius: 50%;
		border: 1px solid rgba(196, 225, 242, 0.45);
		animation: detection-zone-pulse 1.6s ease-in-out infinite;
	}

	.detection-zone.idle {
		background: radial-gradient(circle, rgba(131, 153, 171, 0.86), rgba(28, 43, 55, 0.35));
	}

	.detection-zone.amber {
		background: radial-gradient(circle, rgba(255, 210, 128, 0.92), rgba(221, 135, 19, 0.4));
		box-shadow: 0 0 12px rgba(255, 193, 88, 0.74);
	}

	.detection-zone.red {
		background: radial-gradient(circle, rgba(255, 138, 138, 0.9), rgba(199, 22, 22, 0.42));
		box-shadow: 0 0 14px rgba(255, 71, 71, 0.76);
	}

	.detection-zone.shield {
		background:
			repeating-linear-gradient(
				45deg,
				rgba(128, 255, 212, 0.85) 0 4px,
				rgba(23, 255, 163, 0.55) 4px 8px
			),
			radial-gradient(circle, rgba(128, 255, 212, 0.9), rgba(12, 94, 63, 0.42));
		box-shadow: 0 0 16px rgba(88, 255, 190, 0.8);
	}

	.spam-user-marker {
		position: absolute;
		width: 13px;
		height: 13px;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		background: radial-gradient(circle, #fff2a6, #f8cd34 58%, #6d5300 100%);
		border: 1px solid rgba(248, 205, 52, 0.85);
		box-shadow:
			0 0 8px rgba(255, 217, 95, 0.8),
			0 0 18px rgba(255, 198, 46, 0.55);
		animation: spam-pulse 1.6s ease-in-out infinite;
	}

	.financial-plane-marker {
		position: absolute;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		border: 1px solid rgba(255, 255, 255, 0.42);
		box-shadow: 0 0 12px rgba(255, 255, 255, 0.2);
		animation: financial-pulse 1.4s ease-in-out infinite;
	}

	.financial-plane-marker.email {
		background: radial-gradient(circle, #fff4a2, #e3b520 62%, #5d4300 100%);
	}

	.financial-plane-marker.login {
		background: radial-gradient(circle, #b9e6ff, #2f9eff 62%, #003d75 100%);
	}

	.financial-plane-marker.bank {
		background: radial-gradient(circle, #ffc0f0, #f840aa 62%, #760042 100%);
	}

	.financial-plane-marker.card {
		background: radial-gradient(circle, #ffb9b9, #ff4d3f 62%, #700909 100%);
	}

	.containment-marker {
		position: absolute;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		border: 2px solid rgba(110, 255, 199, 0.9);
		box-shadow:
			0 0 8px rgba(110, 255, 199, 0.75),
			0 0 22px rgba(110, 255, 199, 0.35);
		animation: containment-pulse 1s ease-in-out infinite;
	}

	.stage-label {
		position: absolute;
		bottom: 0.8rem;
		left: 0.9rem;
		margin: 0;
		font-size: 0.77rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		opacity: 0.85;
		font-family: 'IBM Plex Mono', Consolas, monospace;
	}

	.hud-panel {
		display: grid;
		align-content: start;
		padding-top: 0.15rem;
	}

	.why-card {
		background: linear-gradient(145deg, rgba(30, 12, 12, 0.92), rgba(66, 22, 22, 0.86));
		border: 1px solid rgba(255, 127, 106, 0.35);
		border-radius: 14px;
		padding: 0.9rem;
		margin-top: 0.75rem;
		font-family: 'IBM Plex Mono', Consolas, monospace;
		font-size: 0.8rem;
	}

	.why-card h2 {
		margin: 0 0 0.5rem;
		font-size: 0.95rem;
		font-family: 'Space Grotesk', 'Segoe UI', sans-serif;
	}

	.why-summary {
		margin: 0 0 0.55rem;
		font-weight: 600;
		color: #ffd7b5;
	}

	.confidence-row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-bottom: 0.55rem;
	}

	.confidence-bar {
		position: relative;
		height: 9px;
		border-radius: 999px;
		background: linear-gradient(
			90deg,
			rgba(94, 34, 34, 0.8),
			rgba(113, 73, 16, 0.88),
			rgba(31, 110, 63, 0.92)
		);
		overflow: hidden;
	}

	.confidence-fill {
		height: 100%;
		background: linear-gradient(
			90deg,
			rgba(255, 120, 102, 0.74),
			rgba(255, 199, 86, 0.82),
			rgba(114, 255, 191, 0.94)
		);
		box-shadow: 0 0 12px rgba(255, 189, 126, 0.38);
	}

	.confidence-threshold {
		position: absolute;
		top: -1px;
		bottom: -1px;
		width: 2px;
		background: rgba(233, 245, 255, 0.92);
		box-shadow: 0 0 6px rgba(218, 236, 255, 0.82);
	}

	.why-reason {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.26rem 0;
		border-bottom: 1px solid rgba(255, 188, 160, 0.12);
	}

	.why-reason.critical {
		color: #ff8b8b;
	}

	.why-reason.warning {
		color: #ffc778;
	}

	.why-reason.pivot {
		color: #9fd4ff;
	}

	.why-reason.baseline {
		color: #d7ebff;
	}

	.why-reason.decay {
		color: #97a8b8;
	}

	.why-points {
		color: #ffba9c;
		font-weight: 600;
	}

	.why-empty {
		opacity: 0.78;
	}

	.meta-card,
	.containment-card,
	.replay-card,
	.soc-card {
		background: linear-gradient(145deg, rgba(8, 15, 29, 0.94), rgba(11, 36, 58, 0.9));
		border: 1px solid rgba(125, 213, 255, 0.3);
		border-radius: 14px;
		padding: 0.9rem;
		margin-top: 0.75rem;
		font-family: 'IBM Plex Mono', Consolas, monospace;
		font-size: 0.8rem;
	}

	.meta-card h2,
	.containment-card h2,
	.replay-card h2,
	.soc-card h2 {
		margin: 0 0 0.45rem;
		font-size: 0.95rem;
		font-family: 'Space Grotesk', 'Segoe UI', sans-serif;
	}

	.soc-subtitle {
		margin: 0 0 0.55rem;
		opacity: 0.82;
	}

	.soc-card form {
		display: grid;
		gap: 0.45rem;
	}

	.soc-card textarea {
		resize: vertical;
		min-height: 76px;
		border-radius: 10px;
		border: 1px solid rgba(118, 202, 255, 0.35);
		background: rgba(8, 22, 33, 0.76);
		color: #eaf6ff;
		padding: 0.5rem;
		font-family: 'IBM Plex Mono', Consolas, monospace;
		font-size: 0.76rem;
	}

	.soc-answer {
		font-weight: 600;
		color: #b2ffdf;
	}

	.validation-inline,
	.simulation-inline {
		margin-top: 0.55rem;
		padding-top: 0.45rem;
		border-top: 1px solid rgba(118, 202, 255, 0.22);
	}

	.reason-weight-grid {
		margin-top: 0.6rem;
		padding: 0.45rem 0.55rem;
		border-radius: 10px;
		background: rgba(255, 162, 112, 0.08);
		border: 1px solid rgba(255, 162, 112, 0.2);
	}

	.reason-weight-title {
		margin: 0 0 0.35rem;
		font-weight: 700;
		text-transform: uppercase;
		font-size: 0.68rem;
		letter-spacing: 0.05em;
		color: #ffd2b5;
	}

	.replay-buttons {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		margin-bottom: 0.45rem;
	}

	.replay-button {
		border: 1px solid rgba(106, 225, 255, 0.52);
		background: linear-gradient(120deg, rgba(14, 62, 90, 0.95), rgba(10, 42, 70, 0.95));
		color: #dff6ff;
		border-radius: 10px;
		padding: 0.45rem 0.6rem;
		font-family: 'IBM Plex Mono', Consolas, monospace;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.replay-button:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.replay-error {
		color: #ff8f8f;
	}

	.meta-trust {
		color: #8fffd0;
		font-weight: 700;
	}

	.meta-formula {
		opacity: 0.74;
		font-size: 0.72rem;
		line-height: 1.4;
	}

	.vector-card {
		background: linear-gradient(145deg, rgba(6, 17, 31, 0.95), rgba(15, 38, 58, 0.92));
		border: 1px solid rgba(119, 186, 255, 0.25);
		border-radius: 14px;
		padding: 0.9rem;
		font-family: 'IBM Plex Mono', Consolas, monospace;
		font-size: 0.8rem;
	}

	.vector-card h2 {
		margin: 0 0 0.55rem;
		font-size: 0.94rem;
		font-family: 'Space Grotesk', 'Segoe UI', sans-serif;
	}

	.vector-card p {
		margin: 0.35rem 0;
		opacity: 0.88;
	}

	:global(.globe-stage) {
		--pulse-left: 50%;
		--pulse-top: 50%;
	}

	@keyframes rotateSphere {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes pulseWave {
		0% {
			transform: scale(0.74);
			opacity: 0.9;
		}
		100% {
			transform: scale(1.34);
			opacity: 0;
		}
	}

	@keyframes threat-flicker {
		0%,
		100% {
			opacity: 0.38;
		}
		40% {
			opacity: 1;
		}
		70% {
			opacity: 0.62;
		}
	}

	@keyframes path-pulse {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 1;
		}
	}

	@keyframes spam-pulse {
		0%,
		100% {
			transform: translate(-50%, -50%) scale(0.9);
		}
		50% {
			transform: translate(-50%, -50%) scale(1.15);
		}
	}

	@keyframes financial-pulse {
		0%,
		100% {
			transform: translate(-50%, -50%) scale(0.95);
			opacity: 0.82;
		}
		50% {
			transform: translate(-50%, -50%) scale(1.18);
			opacity: 1;
		}
	}

	@keyframes containment-pulse {
		0%,
		100% {
			transform: translate(-50%, -50%) scale(0.8);
			opacity: 0.5;
		}
		50% {
			transform: translate(-50%, -50%) scale(1.18);
			opacity: 1;
		}
	}

	@keyframes detection-zone-pulse {
		0%,
		100% {
			transform: translate(-50%, -50%) scale(0.9);
			opacity: 0.76;
		}
		50% {
			transform: translate(-50%, -50%) scale(1.16);
			opacity: 1;
		}
	}

	@keyframes shield-shatter {
		0% {
			opacity: 0.15;
			transform: translate(0, 0) scale(0.6);
		}
		50% {
			opacity: 1;
			transform: translate(3px, -2px) scale(1.25);
		}
		100% {
			opacity: 0;
			transform: translate(8px, -6px) scale(0.82);
		}
	}

	@media (max-width: 980px) {
		.control-surface {
			grid-template-columns: 1fr;
			min-height: auto;
		}

		.globe-stage {
			min-height: 300px;
		}

		.hud-panel {
			padding-top: 0;
		}
	}
</style>
