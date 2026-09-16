"""Create a macOS-friendly ZIP that preserves the app executable permission."""
from pathlib import Path
import stat
import sys
import zipfile

source, destination = map(Path, sys.argv[1:3])
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(source.rglob('*')):
        relative = path.relative_to(source.parent).as_posix()
        info = zipfile.ZipInfo(relative + ('/' if path.is_dir() else ''))
        mode = 0o755 if path.is_dir() or '/Contents/MacOS/' in f'/{relative}' else 0o644
        info.external_attr = ((stat.S_IFDIR if path.is_dir() else stat.S_IFREG) | mode) << 16
        if path.is_file(): archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
        else: archive.writestr(info, b'')
