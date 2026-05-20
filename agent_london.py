import hashlib
import hmac
import json
import time
from datetime import datetime, timezone

import requests

API_URL = "http://localhost:5173/api/identity-events"
NODE_ID = "SOVEREIGN-LDN-01"
ACTOR_ID = "workstation-agent-london"
SECRET = b"sovereign_secure_key_2026"

SESSION = requests.Session()
SESSION.trust_env = False


def send_pulse() -> None:
    payload = {
        "actorId": ACTOR_ID,
        "workstationId": NODE_ID,
        "biometricType": "FACE_ID",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "action": "AUTH_SUCCESS",
    }

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
            print(
                f"London pulse sent: {payload['timestamp']} | HTTP {response.status_code}"
            )
        else:
            body = response.text[:300].replace("\n", " ")
            print(f"Server rejected London pulse: HTTP {response.status_code} | {body}")
    except Exception as exc:
        print(f"London connection error: {exc}")


if __name__ == "__main__":
    print(f"{NODE_ID} agent active. Monitoring London node...")
    while True:
        send_pulse()
        time.sleep(12)
