#!/usr/bin/env bash
# Publica o release v<versão do tauri.conf.json> com o .deb, o .rpm, o PKGBUILD do AUR (hotswap-bin, que instala o .deb)
# e o instalador do Windows (.exe), compilado daqui pelo cargo-xwin. Para o .exe, uma vez:
#   sudo apt install nsis lld llvm && rustup target add x86_64-pc-windows-msvc && cargo install --locked cargo-xwin
# Roda no CI (release.yml) e à mão, da main já no GitHub:
#   scripts/release.sh
# À mão, os pacotes linkam contra a glibc desta máquina; os do CI (ubuntu-22.04) instalam também nas distros mais antigas.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(jq -r .version src-tauri/tauri.conf.json)
deb=src-tauri/target/release/bundle/deb/hotswap_${VERSION}_amd64.deb
rpm=src-tauri/target/release/bundle/rpm/hotswap-${VERSION}-1.x86_64.rpm
exe=src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/hotswap_${VERSION}_x64-setup.exe
repo=https://github.com/martinsgabriel1956/switch-terminal

git fetch -q --tags origin main
if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
  echo "v$VERSION já tem release; nada a fazer."
  exit 0
fi
# O release aponta para o HEAD: ele tem que ser o que está no GitHub, sem nada por commitar.
git diff --quiet HEAD || { echo "Há mudanças sem commit." >&2; exit 1; }
git merge-base --is-ancestor HEAD origin/main || { echo "O HEAD não está na origin/main; faça o push antes." >&2; exit 1; }

npm test
npm run tauri build -- --bundles deb,rpm
npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis

out=$(mktemp -d)

# O PKGBUILD baixa o .deb deste release; o makepkg já abre o .deb e o package() só extrai o data.tar.
cat > "$out/PKGBUILD" <<PKG
pkgname=hotswap-bin
pkgver=$VERSION
pkgrel=1
pkgdesc='$(jq -r .bundle.shortDescription src-tauri/tauri.conf.json)'
arch=('x86_64')
url='$repo'
license=('unknown')
depends=('webkit2gtk-4.1' 'gtk3' 'libayatana-appindicator')
provides=('hotswap')
conflicts=('hotswap')
source=("$repo/releases/download/v$VERSION/hotswap_${VERSION}_amd64.deb")
sha256sums=('$(sha256sum "$deb" | cut -d' ' -f1)')

package() {
  bsdtar -xf data.tar.* -C "\$pkgdir"
}
PKG

# Notas: os commits desde a última tag, sem o próprio "chore: versão".
prev=$(git describe --tags --abbrev=0 2>/dev/null || true)
{
  echo "## Instalar"
  echo
  echo '```bash'
  echo "sudo apt install ./hotswap_${VERSION}_amd64.deb    # Debian/Ubuntu"
  echo "sudo dnf install ./hotswap-${VERSION}-1.x86_64.rpm  # Fedora"
  echo "makepkg -si                                       # Arch, na pasta do PKGBUILD"
  echo '```'
  echo
  echo "No Windows, \`hotswap_${VERSION}_x64-setup.exe\`."
  echo
  echo "## Mudanças"
  echo
  git log --no-merges --format='- %s' ${prev:+$prev..}HEAD | grep -v '^- chore: versão' || true
} > "$out/notes.md"
cat "$out/notes.md"

gh release create "v$VERSION" "$deb" "$rpm" "$exe" "$out/PKGBUILD" \
  --target "$(git rev-parse HEAD)" --title "Hotswap $VERSION" --notes-file "$out/notes.md"
