# Native JARVIS for macOS

This Swift 6/SwiftUI client uses the existing loopback-only JARVIS service. Chat, agent jobs, SQLite memory, provider routing, OSIRIS, and God's Eye stay in the shared Node service.

## Run

```zsh
cd macos
swift test
swift run JARVISMac
```

The client connects to `http://127.0.0.1:4317` by default. Set `JARVIS_BASE_URL` to another loopback URL when the service uses a different port.

Keep the Obsidian vault readable while placing the SQLite store in Application Support:

```zsh
export JARVIS_OBSIDIAN_VAULT="$HOME/Documents/JARVIS"
export JARVIS_DATA_DIR="$HOME/Library/Application Support/JARVIS/.jarvis"
cd /path/to/jarvis-sphere
node server.mjs
```

The canonical macOS database is then `$HOME/Library/Application Support/JARVIS/.jarvis/jarvis.sqlite`. The Swift app never opens it directly; the local service owns migrations and serialized access.

## Package, sign, and notarize

```zsh
cd macos
zsh scripts/package.sh                 # current architecture
zsh scripts/package.sh --universal     # Intel and Apple Silicon
```

Set `JARVIS_CODESIGN_IDENTITY` to an installed Developer ID Application identity. Set `JARVIS_NOTARY_PROFILE` to a Keychain profile previously created with `xcrun notarytool store-credentials`. The script leaves unsigned local builds unsigned and only submits for notarization when both account setup and a signing identity are present.
