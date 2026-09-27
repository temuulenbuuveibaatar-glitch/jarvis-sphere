#!/bin/zsh
set -euo pipefail
cd "${0:A:h}/.."

arch_args=()
[[ "${1:-}" == "--universal" ]] && arch_args=(--arch arm64 --arch x86_64)
swift build -c release "${arch_args[@]}"

product=".build/JARVIS.app"
rm -rf "$product"
mkdir -p "$product/Contents/MacOS" "$product/Contents/Resources"
cp Resources/Info.plist "$product/Contents/Info.plist"
cp "$(swift build -c release "${arch_args[@]}" --show-bin-path)/JARVISMac" "$product/Contents/MacOS/JARVISMac"

if [[ -n "${JARVIS_CODESIGN_IDENTITY:-}" ]]; then
  codesign --force --options runtime --timestamp --sign "$JARVIS_CODESIGN_IDENTITY" "$product"
fi
if [[ -n "${JARVIS_CODESIGN_IDENTITY:-}" && -n "${JARVIS_NOTARY_PROFILE:-}" ]]; then
  ditto -c -k --keepParent "$product" .build/JARVIS.zip
  xcrun notarytool submit .build/JARVIS.zip --keychain-profile "$JARVIS_NOTARY_PROFILE" --wait
  xcrun stapler staple "$product"
fi
echo "$product"
