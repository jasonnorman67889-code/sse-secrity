import os
import requests
from datetime import datetime, timezone
import sys
import uuid

BASE_URL = os.getenv("SCC_BASE_URL", "http://localhost:5173")
SOURCE_NODE = "Node-LA-01"
TARGET_NODE = "Node-LDN-01"

SESSION = requests.Session()
SESSION.trust_env = False


def post(path: str, payload: dict) -> dict:
    response = SESSION.post(
        f"{BASE_URL}{path}",
        json=payload,
        timeout=6,
        proxies={"http": None, "https": None},
    )
    print(f"POST {path} -> {response.status_code}")
    if response.status_code >= 300:
        raise RuntimeError(f"{path} failed: {response.status_code} {response.text}")
    return response.json()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def run_simulation() -> None:
    user_id = f"pivot-shadow-{uuid.uuid4().hex[:10]}"
    print("[SIM] Starting Pivot-Shadow defensive simulation.")
    print(f"[SIM] Validation user: {user_id}")

    post(
        "/api/risk/spam-events",
        {
            "userId": user_id,
            "nodeId": SOURCE_NODE,
            "urlClicked": True,
            "campaignId": "spam-oauth-persistence",
            "timestamp": now_iso(),
        },
    )

    identity_result = post(
        "/api/risk/identity-logs",
        {
            "userId": user_id,
            "type": "impossible_travel",
            "nodeId": TARGET_NODE,
            "metadata": {
                "source": SOURCE_NODE,
                "target": TARGET_NODE,
                "vector": "pivot-shadow-sim",
            },
            "timestamp": now_iso(),
        },
    )

    correlation = identity_result.get("correlation", {})
    if not correlation.get("triggered"):
        raise RuntimeError(
            "[SIM] Correlation did not trigger. Defensive rule validation failed."
        )

    print("[SIM] Correlation triggered successfully:")
    print(f"      rule={correlation.get('ruleId')}")
    print(
        f"      path={correlation.get('sourceNode')} -> {correlation.get('targetNode')}"
    )
    print(f"      risk={correlation.get('riskScore')}")
    print("[SIM] PASS: Pivot-Shadow defensive validation complete.")


if __name__ == "__main__":
    try:
        run_simulation()
    except Exception as error:
        print(f"[SIM] FAIL: {error}")
        sys.exit(1)
