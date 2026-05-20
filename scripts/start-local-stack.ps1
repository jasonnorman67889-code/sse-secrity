param(
    [string]$ProjectRoot = "C:\Users\HomePC\OneDrive\sse-security-as-code\sse-security\sovereign-command-center-2"
)

if (-not (Test-Path $ProjectRoot)) {
    Write-Error "Project root not found: $ProjectRoot"
    exit 1
}

$devCmd = "Set-Location '$ProjectRoot'; npm run dev"
$agentCmdLa = "Set-Location '$ProjectRoot'; python agent.py"
$agentCmdLondon = "Set-Location '$ProjectRoot'; python agent_london.py"

Start-Process powershell -ArgumentList "-NoExit", "-Command", $devCmd | Out-Null
Start-Process powershell -ArgumentList "-NoExit", "-Command", $agentCmdLa | Out-Null
Start-Process powershell -ArgumentList "-NoExit", "-Command", $agentCmdLondon | Out-Null

Write-Host "Started SvelteKit dev server, LA agent, and London agent in separate terminals."
