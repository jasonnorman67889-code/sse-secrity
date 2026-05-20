param(
    [string]$LosAngelesNode = "los-angeles-primary",
    [string]$LondonNode = "london-secondary",
    [string]$SingaporeNode = "singapore-replay",
    [switch]$SkipDockerServiceCheck
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "[SCC-K8S] $Message"
}

function Invoke-Kubectl {
    param([Parameter(ValueFromRemainingArguments = $true)] [string[]]$Arguments)

    & kubectl @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "kubectl $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Test-NamespaceState {
    param([string]$Name)

    kubectl get namespace $Name --no-headers | Out-Null 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Step "Creating namespace: $Name"
        Invoke-Kubectl create namespace $Name
    }
    else {
        Write-Step "Namespace exists: $Name"
    }
}

function Set-NodeLabels {
    param(
        [string]$Node,
        [string]$Region,
        [string]$Role
    )

    Write-Step "Labeling node $Node (region=$Region role=$Role)"
    Invoke-Kubectl label nodes $Node "region=$Region" "role=$Role" --overwrite
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

$currentContext = & kubectl config current-context 2>$null
if ($LASTEXITCODE -eq 0 -and $currentContext) {
    Write-Step "Current context: $currentContext"
}

if (-not $SkipDockerServiceCheck -and $currentContext -eq "docker-desktop") {
    $dockerService = Get-Service -Name com.docker.service -ErrorAction SilentlyContinue
    if ($dockerService -and $dockerService.Status -ne "Running") {
        throw "Docker Desktop Service (com.docker.service) is $($dockerService.Status). Start Docker Desktop with sufficient permissions, then rerun initialization."
    }
}

Write-Step "Step 0: Initialize defensive namespaces"
Write-Step "Checking Kubernetes API connectivity"
Invoke-Kubectl version --request-timeout=10s

$namespaces = @("simulation", "telemetry", "fraud-defense", "replay", "governance")
foreach ($namespace in $namespaces) {
    Test-NamespaceState -Name $namespace
}

Write-Step "Step 0: Label multi-region nodes"
Set-NodeLabels -Node $LosAngelesNode -Region "los-angeles" -Role "command"
Set-NodeLabels -Node $LondonNode -Region "london" -Role "resilience"
Set-NodeLabels -Node $SingaporeNode -Region "singapore" -Role "simulation"

Write-Step "Step 0: Apply defensive namespace manifests"
Invoke-Kubectl apply -f (Join-Path $repoRoot "k8s/namespaces")

Write-Step "Step 0: Apply storage/network manifests"
Invoke-Kubectl apply -f (Join-Path $repoRoot "k8s/infrastructure/simulation-storage-network.yaml")

Write-Step "Defensive infrastructure initialization complete"
