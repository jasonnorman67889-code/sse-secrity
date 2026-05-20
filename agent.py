import hashlib
import hmac
import json
import time
from datetime import datetime, timezone

import requests

# SOC configuration
API_URL = "http://localhost:5173/api/identity-events"
NODE_ID = "SOVEREIGN-LA-01"
ACTOR_ID = "workstation-agent"
# Prototype-only shared secret for HMAC signing
SECRET = b"sovereign_secure_key_2026"

# Disable proxy inheritance so localhost traffic never gets routed through corp proxies.
SESSION = requests.Session()
SESSION.trust_env = False


def send_pulse() -> None:
    payload = {
        "actorId": ACTOR_ID,
        "workstationId": NODE_ID,
        "biometricType": "FINGERPRINT",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "action": "AUTH_SUCCESS",
    }

    # Canonical JSON prior to signing.
    payload_string = json.dumps(payload, sort_keys=True).encode("utf-8")
    signature = hmac.new(SECRET, payload_string, hashlib.sha256).hexdigest()

    try:
        response = SESSION.post(
            API_URL,
            json={**payload, "signature": signature},
            timeout=5,
            proxies={"http": None, "https": None},
        )
        if response.status_code in (200, 201):
            print(f"Pulse sent: {payload['timestamp']} | HTTP {response.status_code}")
        else:
            body = response.text[:300].replace("\n", " ")
            print(f"Server rejected pulse: HTTP {response.status_code} | {body}")
    except Exception as exc:
        print(f"Connection error: {exc}")


if __name__ == "__main__":
    print(f"{NODE_ID} agent active. Sending pulses every 10s...")
    while True:
        send_pulse()
        time.sleep(10)
