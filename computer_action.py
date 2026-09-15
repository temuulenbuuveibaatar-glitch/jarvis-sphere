"""Explicit, local-only computer actions approved in the JARVIS UI."""
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse
from urllib.request import urlopen
import webbrowser

def fail(message): raise ValueError(message)

def run(action):
    kind = action.get('action')
    if kind == 'open_url':
        url = action.get('url', '')
        if urlparse(url).scheme not in ('http', 'https'): fail('Only http and https links are allowed.')
        webbrowser.open(url); return {'message': 'Opening link in your default browser.'}
    if kind == 'open_app':
        target = Path(action.get('path', '')).expanduser().resolve()
        if not target.exists(): fail('Choose an existing application path.')
        if os.name == 'nt': os.startfile(str(target))
        elif sys.platform == 'darwin': subprocess.Popen(['open', str(target)])
        else: subprocess.Popen(['xdg-open', str(target)])
        return {'message': f'Opening {target.name}.'}
    if kind == 'download':
        url, name = action.get('url', ''), action.get('name', '')
        if urlparse(url).scheme not in ('http', 'https') or not name or Path(name).name != name: fail('Use an http(s) link and a simple file name.')
        destination = Path.home() / 'Downloads' / name
        with urlopen(url, timeout=30) as source, destination.open('wb') as output:
            remaining = 200 * 1024 * 1024
            while remaining:
                chunk = source.read(min(65536, remaining))
                if not chunk: break
                output.write(chunk); remaining -= len(chunk)
            if source.read(1): destination.unlink(missing_ok=True); fail('Download exceeds the 200 MB limit.')
        return {'message': f'Downloaded to {destination}.'}
    if kind == 'run_command':
        command = action.get('command')
        if not isinstance(command, list) or not command or len(command) > 12 or any(not isinstance(part, str) or not part or len(part) > 512 for part in command): fail('Enter a command and up to 11 arguments.')
        result = subprocess.run(command, shell=False, cwd=Path.home(), capture_output=True, text=True, timeout=60, encoding='utf-8', errors='replace')
        return {'message': f'Exit code {result.returncode}.', 'output': (result.stdout + result.stderr)[-12000:]}
    if kind == 'find':
        query = action.get('query', '').lower().strip()
        if not query or len(query) > 64: fail('Enter a file name fragment up to 64 characters.')
        results = []
        for folder, _, files in os.walk(Path.home()):
            for name in files:
                if query in name.lower(): results.append(str(Path(folder) / name))
                if len(results) >= 80: return {'message': 'First 80 matches.', 'results': results}
        return {'message': f'{len(results)} match(es).', 'results': results}
    fail('Unknown action.')

try:
    print(json.dumps(run(json.loads(sys.stdin.read(8192))), ensure_ascii=False))
except Exception as error:
    print(json.dumps({'error': str(error)}))
    sys.exit(1)
