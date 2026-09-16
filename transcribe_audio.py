import base64
import json
import os
import sys
import tempfile


def transcribe(payload):
    encoded = payload.get("audio")
    if not isinstance(encoded, str) or len(encoded) > 8 * 1024 * 1024:
        raise ValueError("Invalid audio payload")
    try:
        data = base64.b64decode(encoded, validate=True)
    except Exception as error:
        raise ValueError("Invalid audio payload") from error
    if not data:
        return {"transcript": ""}
    with tempfile.NamedTemporaryFile(prefix="jarvis-stt-", suffix=".webm", delete=False) as audio:
        audio.write(data)
        filename = audio.name
    try:
        from tools.voice_mode import transcribe_recording
        result = transcribe_recording(filename)
        if not result.get("success"):
            raise RuntimeError(result.get("error") or "Local transcription failed")
        return {"transcript": str(result.get("transcript") or "").strip()}
    finally:
        try:
            os.unlink(filename)
        except OSError:
            pass


if __name__ == "__main__":
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        try:
            print(json.dumps(transcribe(json.loads(line))), flush=True)
        except Exception as error:
            print(json.dumps({"error": str(error)[:240]}), flush=True)
