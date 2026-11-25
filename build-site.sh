#!/usr/bin/env bash
# Build do site fixo da MAMA League: baixa o Showdown no commit de showdown-ref.txt, monta o mod a partir da
# planilha principal, compila e gera public/ (porteiro, jogar.html e mama-dados.js) para o GitHub Pages.
set -euo pipefail

REF=$(tr -d '[:space:]' < showdown-ref.txt)
ANUNCIO=$(node -p "require('./site.json').anuncio")

echo "==> Baixando o Pokémon Showdown ($REF)"
rm -rf pokemon-showdown public
git init -q pokemon-showdown
git -C pokemon-showdown remote add origin https://github.com/smogon/pokemon-showdown.git
git -C pokemon-showdown fetch -q --depth 1 origin "$REF"
git -C pokemon-showdown checkout -q FETCH_HEAD

echo "==> Instalando dependências"
(cd pokemon-showdown && npm ci --no-audit --no-fund)

echo "==> Montando o mod da MAMA League (planilha principal)"
cp atualizar-rebalanceamento.js pokemon-showdown/
(cd pokemon-showdown && node atualizar-rebalanceamento.js)

echo "==> Compilando"
(cd pokemon-showdown && node build)

echo "==> Gerando o site"
node gerar-site.js pokemon-showdown public "$ANUNCIO"
touch public/.nojekyll
echo "==> Pronto"
