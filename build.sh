#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

echo "=========================================="
echo "Atualizando contador de build..."
if [ -f "scripts/increment_build.py" ]; then
  python3 scripts/increment_build.py 2>/dev/null || python scripts/increment_build.py
elif [ -f "scripts/increment-build.js" ]; then
  node scripts/increment-build.js
fi

mkdir -p build
mkdir -p internal/server/public

echo "Sincronizando frontend..."
cp -r public/* internal/server/public/

case "$(uname -s)" in
  Darwin)
    output="build/mdreader-macos"
    label="macOS"
    ;;
  Linux)
    output="build/mdreader-linux"
    label="Linux"
    ;;
  *)
    output="build/mdreader"
    label="$(uname -s)"
    ;;
esac

echo "Compilando mdreader em Go para $label..."
go build -ldflags="-s -w" -o "$output" ./cmd/mdreader

echo
echo "=========================================="
echo "Build concluido com sucesso!"
echo "Executavel gerado em:"
echo "  $output"
echo "=========================================="
