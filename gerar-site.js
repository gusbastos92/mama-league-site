#!/usr/bin/env node
/**
 * Gera o site estático da MAMA League (para o GitHub Pages): index.html (porteiro), jogar.html e mama-dados.js.
 *   node gerar-site.js <raizShowdown> <saida> <anuncioUrl>
 *   ex.: node gerar-site.js pokemon-showdown ..\docs https://script.google.com/macros/s/.../exec
 * Baixa o index oficial de play.pokemonshowdown.com (a página de quem não tem o servidor local).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { montar, dados } = require('./mama-site.js');

const KIT = __dirname;
const OFICIAL = 'https://play.pokemonshowdown.com/';

// o porteiro: o modelo porteiro.html com o site-servidor.js embutido (dentro de uma função, sem variáveis globais)
// e o endereço do anúncio no lugar de __ANUNCIO_URL__
function montarPorteiro(anuncioUrl) {
	const modelo = fs.readFileSync(path.join(KIT, 'porteiro.html'), 'utf8');
	const servidor = fs.readFileSync(path.join(KIT, 'site-servidor.js'), 'utf8');
	const url = JSON.stringify(String(anuncioUrl || '')).replace(/</g, '\\u003c');
	return modelo
		.replace('/*__SITE_SERVIDOR__*/', () => '(function () {\n' + servidor + '\n})();')
		.replace('__ANUNCIO_URL__', () => url);
}

async function gerarSite({ raiz, saida, anuncioUrl, htmlOficial }) {
	fs.mkdirSync(saida, { recursive: true });
	const arquivos = {
		'index.html': montarPorteiro(anuncioUrl),
		'jogar.html': montar(htmlOficial, { estatico: true }),
		'mama-dados.js': dados(raiz),
	};
	for (const [nome, conteudo] of Object.entries(arquivos)) fs.writeFileSync(path.join(saida, nome), conteudo);
	return Object.keys(arquivos);
}

async function principal(argv) {
	const [raiz, saida, anuncioUrl] = argv;
	if (!raiz || !saida || anuncioUrl === undefined) {
		console.error('uso: node gerar-site.js <raizShowdown> <saida> <anuncioUrl>');
		process.exit(1);
	}
	const r = await fetch(OFICIAL);
	if (!r.ok) throw new Error('play.pokemonshowdown.com respondeu ' + r.status);
	const destino = path.resolve(saida);
	const nomes = await gerarSite({ raiz: path.resolve(raiz), saida: destino, anuncioUrl, htmlOficial: await r.text() });
	console.log('Site gerado em ' + destino + ': ' + nomes.join(', '));
}

if (require.main === module) {
	principal(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { gerarSite, montarPorteiro };
