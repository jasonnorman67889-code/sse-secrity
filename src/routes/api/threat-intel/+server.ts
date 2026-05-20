import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Curated simulation feed for globe overlays.
const THREAT_POINTS = [
    { id: 'c2-fra-1', label: 'Suspected C2 Cluster', lat: 50.1109, lon: 8.6821, severity: 'high' },
    { id: 'scan-ams-1', label: 'Credential Spray Wave', lat: 52.3676, lon: 4.9041, severity: 'medium' },
    { id: 'bot-sgp-1', label: 'Botnet Beaconing', lat: 1.3521, lon: 103.8198, severity: 'high' },
    { id: 'phish-lim-1', label: 'Phishing Relay', lat: -12.0464, lon: -77.0428, severity: 'low' }
] as const;

export const GET: RequestHandler = async () => {
    return json({ points: THREAT_POINTS, generatedAt: new Date().toISOString() });
};
