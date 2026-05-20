"""
Autonomous SOC Triage Agent (Phase 25)

This script is intentionally defensive-only and simulation-friendly.
It demonstrates a LangChain-based Tier 1/Tier 2 workflow with Graph and
Threat Intel tools. If LangChain or model credentials are unavailable,
it degrades to a local heuristic path.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict


def neo4j_query(query: str) -> str:
    """Placeholder graph query tool for SOC investigations."""
    return f"Graph query executed (simulation mode): {query[:120]}"


def get_ip_reputation(ip: str) -> str:
    """Simple reputation heuristic for demo and offline testing."""
    if ip.startswith("10.") or ip.startswith("192.168."):
        return "low-risk-private-space"
    if ip.startswith("185.") or ip.startswith("102."):
        return "elevated-risk-exit-node-pattern"
    return "unknown-medium-risk"


def heuristic_investigate_identity(anomaly_data: Dict[str, Any]) -> str:
    score = float(anomaly_data.get("anomaly_score", 0.0))
    ip = str(anomaly_data.get("ip_address", "unknown"))
    geo = str(anomaly_data.get("geo", "unknown"))
    reputation = get_ip_reputation(ip)

    if score >= 0.7 or "elevated" in reputation:
        return (
            f"High-confidence session hijack candidate. ip={ip} geo={geo} "
            f"reputation={reputation}. Recommend containment + step-up auth."
        )

    return (
        f"Medium anomaly. ip={ip} geo={geo} reputation={reputation}. "
        "Recommend monitor + graph expansion before containment."
    )


def try_langchain_agent(anomaly_data: Dict[str, Any]) -> str:
    try:
        from langchain.agents import Tool, initialize_agent
        from langchain_openai import ChatOpenAI
    except Exception as exc:  # pragma: no cover - optional dependency path
        return f"LangChain unavailable ({exc}); fallback: {heuristic_investigate_identity(anomaly_data)}"

    if not (os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_ADMIN_KEY")):
        return (
            "OpenAI credentials missing; fallback: "
            f"{heuristic_investigate_identity(anomaly_data)}"
        )

    try:
        llm = ChatOpenAI(temperature=0)
    except Exception as exc:  # pragma: no cover - model client init path
        return f"LangChain model unavailable ({exc}); fallback: {heuristic_investigate_identity(anomaly_data)}"

    tools = [
        Tool(
            name="GraphSearch",
            func=neo4j_query,
            description="Queries identity relationship graph for blast radius and lateral movement",
        ),
        Tool(
            name="ThreatIntel",
            func=get_ip_reputation,
            description="Checks indicator reputation and malicious exit-node patterns",
        ),
    ]

    try:
        agent = initialize_agent(
            tools, llm, agent="zero-shot-react-description", verbose=False
        )
    except Exception as exc:  # pragma: no cover - agent init path
        return f"LangChain agent initialization failed ({exc}); fallback: {heuristic_investigate_identity(anomaly_data)}"

    prompt = (
        "You are an autonomous SOC triage agent. "
        "Given anomaly data, decide false positive vs high-confidence threat, "
        "include blast radius intuition and remediation guidance. "
        f"anomaly_data={json.dumps(anomaly_data)}"
    )

    try:
        return str(agent.run(prompt))
    except Exception as exc:  # pragma: no cover - model runtime path
        return f"LangChain execution failed ({exc}); fallback: {heuristic_investigate_identity(anomaly_data)}"


def main() -> None:
    raw = os.getenv("SOC_ANOMALY_JSON", "")
    if raw:
        anomaly_data = json.loads(raw)
    else:
        anomaly_data = {
            "user_id": "user-1042",
            "anomaly_score": 0.82,
            "ip_address": "102.89.12.5",
            "geo": "Lagos",
            "signal": "impossible_travel",
        }

    result = try_langchain_agent(anomaly_data)
    print("[AUTONOMOUS-SOC-AGENT]", result)


if __name__ == "__main__":
    main()
