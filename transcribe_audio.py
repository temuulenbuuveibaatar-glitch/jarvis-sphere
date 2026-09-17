import base64
import json
import os
import sys
import tempfile

model = None


def init_backend():
    global model
    from faster_whisper import WhisperModel
    import numpy as np
    model = WhisperModel(os.environ.get('JARVIS_STT_MODEL', 'base'), device='cpu', compute_type='int8')
    segments, _ = model.transcribe(np.zeros(16000, dtype=np.float32), language='en')
    list(segments)  # Inference is lazy; exercise it before announcing readiness.


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
        if model is None:
            raise RuntimeError('Local speech model is not initialized')
        segments, _ = model.transcribe(filename, vad_filter=True, condition_on_previous_text=False)
        return {"transcript": ' '.join(segment.text.strip() for segment in segments).strip()}
    finally:
        try:
            os.unlink(filename)
        except OSError:
            pass


if __name__ == "__main__":
    try:
        init_backend()
    except Exception as error:
        print(json.dumps({"ready": False, "error": str(error)[:240]}), flush=True)
        sys.exit(1)
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        try:
            print(json.dumps(transcribe(json.loads(line))), flush=True)
        except Exception as error:
            print(json.dumps({"error": str(error)[:240]}), flush=True)
