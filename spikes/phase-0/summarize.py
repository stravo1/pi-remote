import json, sys
rows = [json.loads(line) for line in open(sys.argv[1])]
start = rows[0]["receivedAt"]
for row in rows:
    event = row["event"]
    kind = event["type"]
    detail = ""
    if kind == "message_update":
        sub = event["assistantMessageEvent"]["type"]
        if sub.endswith("delta"):
            continue
        detail = sub
    elif kind in ("message_start", "message_end"):
        message = event["message"]
        text = [c.get("text", "") for c in message.get("content", []) if isinstance(c, dict) and c.get("type") == "text"]
        detail = f'{message["role"]} {message.get("stopReason", "")} {json.dumps(" ".join(text))[:80]}'
    elif kind == "queue_update":
        detail = json.dumps({"steering": event["steering"], "followUp": event["followUp"]})
    elif kind in ("agent_end", "agent_settled"):
        detail = json.dumps({k: v for k, v in event.items() if k not in ("type", "messages")})
    print(row["receivedAt"] - start, kind, detail)
