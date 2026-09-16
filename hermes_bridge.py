"""One bounded, tool-free conversation through a configured provider."""
import contextlib
import io
import json
import os
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SYSTEM_MESSAGE = (
    "You are JARVIS, a professional, deeply caring personal assistant. Help with explanations, writing, planning, and brainstorming from incomplete clues. "
    "When the user is trying to remember something, ask concise clarifying questions and offer grounded possibilities without pretending certainty. "
    "You have no computer, file, camera, microphone, web or command access. Never claim to have "
    "performed actions or sensed anything. Answer in the user's language. Be candid about uncertainty."
)

def fail(message):
    raise RuntimeError(message)

def response_text(result):
    if result.get("failed") or result.get("error") or result.get("interrupted"):
        fail("Provider did not complete the request")
    reply = result.get("final_response")
    if not isinstance(reply, str) or not reply.strip():
        fail("Empty response")
    return reply

def load_hermes_environment():
    hermes_home = Path(os.environ.get("HERMES_HOME", r"C:\\Hermes"))
    sys.path.insert(0, str(hermes_home / "hermes-agent"))
    from dotenv import load_dotenv
    import yaml
    load_dotenv(hermes_home / ".env", override=False)
    config = yaml.safe_load((hermes_home / "config.yaml").read_text(encoding="utf-8")) or {}
    return config

def hermes_reply(messages):
    config = load_hermes_environment()
    model_config = config.get("model", {})
    if isinstance(model_config, str):
        model_config = {"default": model_config}
    os.environ["HERMES_SAFE_MODE"] = "1"
    from run_agent import AIAgent
    agent = AIAgent(
        model=model_config.get("default", "auto"), provider=model_config.get("provider", "custom"),
        base_url=model_config.get("base_url") or os.environ.get("OPENAI_BASE_URL"),
        api_key=os.environ.get("OPENAI_API_KEY"), enabled_toolsets=[], quiet_mode=True,
        max_iterations=2, max_tokens=1200, skip_context_files=True, skip_memory=True,
        skip_background_review=True, load_soul_identity=False, save_trajectories=False,
        run_budget_seconds=75,
    )
    if agent.tools or agent.valid_tool_names:
        fail("Tool-free boundary failed")
    result = agent.run_conversation(
        user_message=messages[-1]["content"], conversation_history=messages[:-1],
        system_message=SYSTEM_MESSAGE,
    )
    return response_text(result)

def post_json(url, headers, payload):
    request = Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    try:
        with urlopen(request, timeout=75) as response:
            return json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, ValueError):
        fail("Configured provider did not complete the request")

def openrouter_reply(messages):
    key = os.environ.get("OPENROUTER_API_KEY")
    model = os.environ.get("JARVIS_OPENROUTER_MODEL")
    if not key or not model:
        fail("OpenRouter is not configured")
    result = post_json(
        "https://openrouter.ai/api/v1/chat/completions",
        {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        {"model": model, "messages": [{"role": "system", "content": SYSTEM_MESSAGE}, *messages], "max_tokens": 1200},
    )
    try:
        reply = result["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        fail("OpenRouter returned no assistant text")
    if not isinstance(reply, str) or not reply.strip():
        fail("OpenRouter returned no assistant text")
    return reply

def omniroute_reply(messages):
    key = os.environ.get("OMNIROUTE_API_KEY")
    if not key:
        fail("OmniRoute is not configured")
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    result = post_json(
        f"{os.environ.get('OMNIROUTE_BASE_URL', 'http://127.0.0.1:20128/v1').rstrip('/')}/chat/completions", headers,
        {"model": os.environ.get("JARVIS_OMNIROUTE_MODEL", "auto"), "messages": [{"role": "system", "content": SYSTEM_MESSAGE}, *messages], "max_tokens": 1200},
    )
    try:
        reply = result["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        fail("OmniRoute returned no assistant text")
    if not isinstance(reply, str) or not reply.strip():
        fail("OmniRoute returned no assistant text")
    return reply

def bytez_reply(messages):
    key = os.environ.get("BYTEZ_API_KEY")
    model = os.environ.get("JARVIS_BYTEZ_MODEL")
    if not key or not model:
        fail("Bytez is not configured")
    result = post_json(
        "https://api.bytez.com/models/v2/openai/v1/chat/completions",
        {"Authorization": key, "Content-Type": "application/json"},
        {"model": model, "messages": [{"role": "system", "content": SYSTEM_MESSAGE}, *messages], "max_tokens": 1200},
    )
    try:
        reply = result["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        fail("Bytez returned no assistant text")
    if not isinstance(reply, str) or not reply.strip():
        fail("Bytez returned no assistant text")
    return reply

def gemini_reply(messages):
    key = os.environ.get("GEMINI_API_KEY")
    model = os.environ.get("JARVIS_GEMINI_MODEL", "gemini-2.5-flash-lite")
    if not key:
        fail("Gemini is not configured")
    contents = [{"role": "user", "parts": [{"text": SYSTEM_MESSAGE}]}]
    for message in messages:
        role = "model" if message["role"] == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": message["content"]}]})
    result = post_json(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        {"x-goog-api-key": key, "Content-Type": "application/json"},
        {"contents": contents, "generationConfig": {"maxOutputTokens": 1200}},
    )
    try:
        parts = result["candidates"][0]["content"]["parts"]
        reply = "".join(part.get("text", "") for part in parts)
    except (KeyError, IndexError, TypeError):
        fail("Gemini returned no assistant text")
    if not reply.strip():
        fail("Gemini returned no assistant text")
    return reply

def main():
    payload = json.loads(sys.stdin.read(32769))
    provider = os.environ.get("JARVIS_PROVIDER", "hermes").lower()
    with contextlib.redirect_stdout(io.StringIO()):
        if provider == "hermes":
            reply = hermes_reply(payload["messages"])
        elif provider == "omniroute":
            reply = omniroute_reply(payload["messages"])
        elif provider == "openrouter":
            reply = openrouter_reply(payload["messages"])
        elif provider == "bytez":
            reply = bytez_reply(payload["messages"])
        elif provider == "gemini":
            reply = gemini_reply(payload["messages"])
        else:
            fail("Unknown JARVIS_PROVIDER")
    print(json.dumps({"reply": reply}, ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("JARVIS provider bridge failed; inspect the selected provider configuration locally.", file=sys.stderr)
        sys.exit(1)
