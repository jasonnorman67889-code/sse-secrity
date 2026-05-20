# Sovereign Workstation Agent (Go)

This lightweight agent simulates biometric pulses from Node-LA-01, signs each payload with ECDSA, and posts events to the Sovereign Command Center API.

## Environment variables

- SOVEREIGN_API_ENDPOINT (default: <http://localhost:5173/api/identity-events>)
- SOVEREIGN_NODE_ID (default: Node-LA-01)
- NODE_ID (alias for SOVEREIGN_NODE_ID)
- SOVEREIGN_ACTOR_ID (default: workstation-agent)
- ACTOR_ID (alias for SOVEREIGN_ACTOR_ID)
- SOVEREIGN_SCAN_INTERVAL_SECONDS (default: 10)
- SOVEREIGN_HTTP_TIMEOUT_SECONDS (default: 10)
- SOVEREIGN_PRIVATE_KEY_PATH (default: ./keys/sovereign_private.pem)
- LAT (default: 34.0522)
- LON (default: -118.2437)

## Build (Windows)

```powershell
go build -o .\bin\sovereign-workstation-agent.exe .\workstation-agent\main.go
```

## Run

```powershell
.\bin\sovereign-workstation-agent.exe
```
