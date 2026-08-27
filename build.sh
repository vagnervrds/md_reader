#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Instalando dependencias..."
  npm install
fi

mkdir -p build

case "$(uname -s)" in
  Darwin)
    target="node18-macos-x64"
    output="build/mdreader-macos"
    label="macOS x64"
    ;;
  Linux)
    target="node18-linux-x64"
    output="build/mdreader-linux"
    label="Linux x64"
    ;;
  *)
    echo "Sistema nao suportado por este script: $(uname -s)"
    exit 1
    ;;
esac

echo "Compilando mdreader para $label..."
npx pkg . --targets "$target" --output "$output"

echo
echo "Build gerado em:"
echo "  $output"
printf "\nPressione Enter para fechar..."
read _answer
