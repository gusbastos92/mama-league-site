'use strict';
/**
 * Site próprio da MAMA League (fica em pokemon-showdown/config/mama-site.js; o config.js chama ele).
 *
 * O servidor passa a responder:
 *   /                → o Showdown (o site oficial, carregado de play.pokemonshowdown.com) já ligado neste servidor
 *   /mama-dados.js   → os dados da MAMA League para o Teambuilder: tipos, stats, habilidades, learnsets,
 *                      moves e habilidades novas e a lista de Pokémon prontos (lidos do próprio mod)
 *   /~~…/action.php  → respostas vazias (não tem servidor de login: cada um escolhe um nome, sem senha)
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const OFICIAL = 'https://play.pokemonshowdown.com/';
const MOD = 'mamaleague';

let paginaCache = null, paginaHora = 0, paginaBuscando = null;
const dadosCache = new Map();   // por pasta do servidor

function responder(req, res) {
	const url = (req.url || '/').split('?')[0];
	try {
		if (url === '/' || url === '/index.html' || url === '/mama' || url === '/mama.html') {
			pagina().then((html) => enviar(res, 200, 'text/html; charset=utf-8', html),
				(e) => enviar(res, 500, 'text/plain; charset=utf-8', 'Não consegui montar o site: ' + e.message));
			return true;
		}
		if (url === '/mama-dados.js') {
			enviar(res, 200, 'application/javascript; charset=utf-8', dados());
			return true;
		}
		if (/^\/~~[^/]+\/action\.php$/.test(url)) {
			// o site estático (jogar.html, em outra origem) chama o action.php daqui
				enviar(res, 200, 'text/plain; charset=utf-8', ']{}', { 'Access-Control-Allow-Origin': '*' });
			return true;
		}
	} catch (e) {
		enviar(res, 500, 'text/plain; charset=utf-8', 'Erro no site da MAMA League: ' + e.message);
		return true;
	}
	return false;
}

function enviar(res, status, tipo, corpo, extra) {
	if (res.headersSent) return;
	res.writeHead(status, Object.assign({ 'Content-Type': tipo, 'Cache-Control': 'no-cache' }, extra || {}));
	res.end(corpo);
}

// ---------- a página: o index oficial, com o servidor, o login sem senha e os dados da MAMA League
async function pagina() {
	if (paginaCache && Date.now() - paginaHora < 6 * 3600 * 1000) return paginaCache;
	if (!paginaBuscando) {
		paginaBuscando = (async () => {
			const r = await fetch(OFICIAL, { redirect: 'follow' });
			if (!r.ok) throw new Error('play.pokemonshowdown.com respondeu ' + r.status);
			paginaCache = montar(await r.text());
			paginaHora = Date.now();
			return paginaCache;
		})().finally(() => { paginaBuscando = null; });
	}
	try {
		return await paginaBuscando;
	} catch (e) {
		if (paginaCache) return paginaCache;   // sem internet agora: usa a última que deu certo
		throw e;
	}
}

// opcoes.estatico: o site fica em outro endereço (GitHub Pages) e escolhe o servidor pelo ?servidor= ou pelo salvo
function montar(html, opcoes) {
	const estatico = !!(opcoes && opcoes.estatico);
	const versao = Date.now().toString(36);
	let h = html
		.replace(/(src|href)="\/\/play\.pokemonshowdown\.com\//g, '$1="' + OFICIAL)
		.replace(/<script>\s*\(function\(i,s,o,g,r,a,m\)[\s\S]*?<\/script>/, '')        // Google Analytics
		.replace(/<link[^>]+manifest\.json[^>]*>/, '')
		.replace(/<script[^>]+clean-cookies\.php[^>]*><\/script>/, '')
		.replace(/<title>[^<]*<\/title>/, '<title>MAMA League · Showdown</title>');

	const antesLocal = `<script>
	// servidor: este mesmo endereço (localhost, IP da rede ou o túnel https)
	// o site oficial mostra um alerta para qualquer erro de script (era para ir ao Google Analytics): aqui vai só para o console
	window.onerror = function (err, uri, line) {
		try { console.warn('Erro de script (ignorado):', uri + ':' + line + ': ' + err); } catch (e) {}
		return true;
	};
	(function () {
		var https = location.protocol === 'https:';
		var porta = location.port ? parseInt(location.port, 10) : (https ? 443 : 80);
		Config.server = { id: '${MOD}', host: location.hostname, port: porta, httpport: porta, https: https, registered: false };
		Config.testclient = true;
		Config.roomsFirstOpenScript = null;   // sem os anúncios do site oficial
		Config.includes = {};
		window.POKEMON_SHOWDOWN_TESTCLIENT_KEY = 'mamaleague';
	})();
</script>`;
	// estático: ?servidor=<host> (ou o salvo); "nenhum" ou nada = offline (o Teambuilder funciona, sem conectar)
	const antesEstatico = `<script>
	window.onerror = function (err, uri, line) {
		try { console.warn('Erro de script (ignorado):', uri + ':' + line + ': ' + err); } catch (e) {}
		return true;
	};
	(function () {
		var q = null, salvo = '', host = '';
		try { q = new URLSearchParams(location.search).get('servidor'); } catch (e) {}
		try { salvo = localStorage.getItem('mama_servidor') || ''; } catch (e) {}
		host = q !== null ? q.trim() : salvo;
		if (host === 'nenhum' || !/^[a-z0-9.-]+$/i.test(host)) host = '';
		if (host) { try { localStorage.setItem('mama_servidor', host); } catch (e) {} }
		Config.server = { id: '${MOD}', host: host || 'nenhum.invalid', port: 443, https: true, registered: false };
		Config.testclient = true;
		Config.roomsFirstOpenScript = null;
		Config.includes = {};
		window.POKEMON_SHOWDOWN_TESTCLIENT_KEY = 'mamaleague';
		try {
			var a = document.createElement('a');
			a.href = 'index.html?manual=1';
			a.textContent = 'trocar servidor';
			a.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:9999;background:#fff;padding:2px 6px;border-radius:4px;font-size:12px';
			document.body.appendChild(a);
		} catch (e) {}
	})();
</script>`;
	const antes = estatico ? antesEstatico : antesLocal;
	const acaoJs = estatico ? "'https://' + Config.server.host + '/~~" + MOD + "/action.php'"
		: "location.protocol + '//' + location.host + '/~~" + MOD + "/action.php'";
	const login = `<script>
	// sem servidor de login: o nome vai direto para o servidor (que está com noguestsecurity)
	(function () {
		var acao = ${acaoJs};
		User.prototype.getActionPHP = function () { return acao; };
		User.prototype.rename = function (name) {
			name = String(name || '').replace(/[\\|,;]+/g, '').trim();
			for (var i in this.replaceList) name = name.replace(this.replaceList[i], i);
			for (var j in this.normalizeList) name = name.replace(this.normalizeList[j], j);
			if (!toUserid(name)) return app.addPopupMessage('O nome precisa ter pelo menos uma letra.');
			try { localStorage.setItem('mama_nome', name); } catch (e) {}
			app.trigger('loggedin');
			app.send('/trn ' + name);
		};
		User.prototype.passwordRename = function (name) { this.rename(name); };
		User.prototype.receiveChallstr = function (challstr) {
			if (!challstr) return;
			this.challstr = challstr;
			this.loaded = true;
			var nome = '';
			try { nome = localStorage.getItem('mama_nome') || ''; } catch (e) {}
			if (nome) this.rename(nome); else if (app.topbar) app.topbar.updateUserbar();
		};
	})();
</script>`;
	const dadosTag = estatico ? `<script src="mama-dados.js?${versao}"></script>` : `<script src="/mama-dados.js?${versao}"></script>`;

	h = inserirDepois(h, /<script[^>]+config\/config\.js[^>]*><\/script>/, antes);
	h = inserirAntes(h, /<script>\s*\/\/ framebust/, login);
	h = inserirDepois(h, /<script[^>]+data\/teambuilder-tables\.js[^>]*><\/script>/, dadosTag);
	return h;
}
function inserirDepois(h, re, txt) {
	const m = re.exec(h);
	if (!m) throw new Error('o site oficial mudou (não achei ' + re + ')');
	return h.slice(0, m.index + m[0].length) + '\n' + txt + h.slice(m.index + m[0].length);
}
function inserirAntes(h, re, txt) {
	const m = re.exec(h);
	if (!m) throw new Error('o site oficial mudou (não achei ' + re + ')');
	return h.slice(0, m.index) + txt + '\n' + h.slice(m.index);
}

// ---------- os dados: lidos do mod compilado (dist/data/mods/mamaleague), igual ao que vale na batalha
function dados(raiz = RAIZ) {
	if (dadosCache.has(raiz)) return dadosCache.get(raiz);
	const { Dex } = require(path.join(raiz, 'dist', 'sim', 'dex'));
	const dex = Dex.mod(MOD);
	const base = Dex.mod('gen9');
	// só as entradas que o mod mexe (o Dex junta tudo no mesmo objeto, então lê os nomes do arquivo do mod)
	const doMod = (arq) => {
		const out = {};
		try {
			const txt = fs.readFileSync(path.join(raiz, 'data', 'mods', MOD, arq + '.ts'), 'utf8');
			for (const m of txt.matchAll(/^\t["']?([a-z0-9]+)["']?\s*:\s*\{/gm)) out[m[1]] = 1;
		} catch {}
		return out;
	};
	const modPokedex = doMod('pokedex');
	const modLearnsets = doMod('learnsets');
	const modMoves = doMod('moves');
	const modAbilities = doMod('abilities');

	const especies = {}, learnsets = {}, moves = {}, habilidades = {};
	const ordem = [];
	for (const id of Object.keys(modPokedex)) {
		const s = dex.species.get(id);
		if (!s.exists) continue;
		const e = { types: s.types.slice(), baseStats: Object.assign({}, s.baseStats), abilities: Object.assign({}, s.abilities) };
		if (!base.species.get(id).exists) {
			Object.assign(e, { num: s.num, name: s.name, baseSpecies: s.baseSpecies, forme: s.forme, heightm: s.heightm, weightkg: s.weightkg,
				prevo: s.prevo || undefined, evos: s.evos && s.evos.length ? s.evos : undefined, gender: s.gender || undefined });
		}
		especies[id] = e;
		ordem.push(s);
	}
	ordem.sort((a, b) => a.num - b.num || a.name.localeCompare(b.name));

	for (const id of Object.keys(modLearnsets)) {
		const ls = (dex.data.Learnsets[id] || {}).learnset || {};
		const t = {};
		for (const mid of Object.keys(ls)) {
			const fontes = ls[mid] || [];
			if (!fontes.some((f) => f.startsWith('9'))) continue;
			t[mid] = '9a' + (fontes.some((f) => f.startsWith('9E')) ? 'e' : '');
		}
		learnsets[id] = t;
	}
	const camposMove = ['num', 'name', 'type', 'category', 'basePower', 'accuracy', 'pp', 'priority', 'target', 'flags', 'desc', 'shortDesc'];
	for (const id of Object.keys(modMoves)) {
		const m = dex.moves.get(id);
		if (!m.exists) continue;
		const o = {};
		for (const k of camposMove) if (m[k] !== undefined) o[k] = m[k];
		moves[id] = o;
	}
	// golpes que congelavam e agora causam Frostbite (o scripts.ts do mod troca em todos): descrição nova
	for (const id of Object.keys(dex.data.Moves)) {
		if (moves[id]) continue;
		const m = dex.moves.get(id), b = base.moves.get(id);
		const secs = (m.secondaries || []).filter((s) => s.status === 'frb');
		if (!secs.length || !(b.secondaries || []).some((s) => s.status === 'frz')) continue;
		// mesmo texto do Showdown, trocando "freeze" por "frostbite"
		const troca = (s) => String(s || '').replace(/\bfreeze\b/gi, 'frostbite').replace(/\bfrozen\b/gi, 'frostbitten');
		const desc = troca(m.desc) || `Has a ${secs[0].chance || 100}% chance to frostbite the target.`;
		moves[id] = { name: m.name, desc, shortDesc: troca(m.shortDesc) || `${secs[0].chance || 100}% chance to frostbite the target.` };
	}
	for (const id of Object.keys(modAbilities)) {
		const a = dex.abilities.get(id);
		if (!a.exists) continue;
		habilidades[id] = { num: a.num, name: a.name, rating: a.rating, desc: a.desc || a.shortDesc || '', shortDesc: a.shortDesc || a.desc || '' };
	}

	const D = { especies, learnsets, moves, habilidades, ordem: ordem.map((s) => s.id) };
	const saida = `/* MAMA League: dados do mod "${MOD}" para o Teambuilder (gerado pelo servidor) */
(function () {
	var D = ${JSON.stringify(D)};
	function semPast(t) { if (!t) return; for (var k in t) if (t[k] && t[k].isNonstandard === 'Past') delete t[k].isNonstandard; }
	// as regras da MAMA League são National Dex: nada fica escondido como "Past"
	semPast(window.BattlePokedex); semPast(window.BattleMovedex); semPast(window.BattleItems); semPast(window.BattleAbilities);
	function junta(tabela, id, novo) {
		var atual = tabela[id];
		if (!atual) { tabela[id] = Object.assign({}, novo); return; }
		for (var k in novo) atual[k] = novo[k];
		delete atual.isNonstandard;
	}
	for (var id in D.especies) { junta(BattlePokedex, id, D.especies[id]); BattlePokedex[id].tier = 'MAMA League'; }
	for (var mv in D.moves) junta(BattleMovedex, mv, D.moves[mv]);
	for (var ab in D.habilidades) junta(BattleAbilities, ab, D.habilidades[ab]);
	var T = window.BattleTeambuilderTable;
	if (T) {
		T.learnsets = T.learnsets || {};
		for (var ls in D.learnsets) T.learnsets[ls] = D.learnsets[ls];
		var lista = [['header', 'MAMA League']].concat(D.ordem);
		[T, T.gen9doubles].forEach(function (t) {
			if (!t) return;
			t.tiers = lista.slice();
			t.tierSet = null;
			// o Teambuilder monta a lista por fatias de tier: tudo numa fatia só (OU / DOU), sem repetir
			var n = lista.length;
			t.formatSlices = { OU: 0, UU: n, RU: n, NU: n, PU: n, ZU: n, AG: n, Uber: n, UUBL: n, LC: n, Regular: 0, Restricted: 0,
				DOU: 0, DUU: n, DNU: n, DUber: n };
		});
	}
	window.MAMA_LEAGUE = D;
	// Frostbite (status "frb" da MAMA League): cor na barra de HP e textos da batalha
	try {
		var css = document.createElement('style');
		css.textContent = '.statbar span.frb,span.frb{padding:1px 2px;border-radius:3px;background:#5BB8E6;color:#fff}';
		document.head.appendChild(css);
	} catch (e) {}
	// golpes e habilidades novos no índice de busca do Teambuilder (para achar digitando o nome e ficar em ordem alfabética)
	function poeIndice(id, tipo) {
		var I = window.BattleSearchIndex, O = window.BattleSearchIndexOffset;
		if (!I) return;
		var lo = 0, hi = I.length;
		while (lo < hi) { var mid = (lo + hi) >> 1; if (I[mid][0] < id) lo = mid + 1; else hi = mid; }
		for (var k = lo; k < I.length && I[k][0] === id; k++) if (I[k][1] === tipo) return;
		I.splice(lo, 0, [id, tipo]);
		if (O) O.splice(lo, 0, '');
	}
	for (var m2 in D.moves) poeIndice(m2, 'move');
	for (var a2 in D.habilidades) poeIndice(a2, 'ability');

	// textos: descrições da MAMA League (o Teambuilder lê de BattleText, que o site oficial carrega depois) e o Frostbite na batalha
	var frb = {
		start: '  {POKEMON} was frostbitten!',
		alreadyStarted: '  {POKEMON} is already frostbitten!',
		end: '  {POKEMON} was healed of its frostbite!',
		damage: '  {POKEMON} was hurt by its frostbite!',
	};
	function poeNaTabela(tabela, fonte) {
		for (var id in fonte) {
			var f = fonte[id];
			if (!f.desc && !f.shortDesc) continue;
			var t = tabela[id] || (tabela[id] = { name: f.name });
			t.desc = f.desc || f.shortDesc;
			t.shortDesc = f.shortDesc || f.desc;
		}
	}
	// golpes da MAMA League nunca vão para "Usually useless moves" (a lista de golpes bons do site oficial não conhece eles)
	var exclusivos = {};
	for (var mx in D.moves) if (D.moves[mx].num < 0 || D.moves[mx].category) exclusivos[mx] = 1;
	function ajustaBusca() {
		var B = window.BattleMoveSearch;
		if (!B || !B.prototype || !B.prototype.moveIsNotUseless || B.prototype.__mama) return;
		var original = B.prototype.moveIsNotUseless;
		B.prototype.moveIsNotUseless = function (id) {
			if (exclusivos[id]) return true;
			return original.apply(this, arguments);
		};
		B.prototype.__mama = true;
	}
	(function poeTextos() {
		ajustaBusca();
		var T = window.BattleText;
		if (T) {
			for (var lang in T) {
				var L = T[lang];
				if (!L || typeof L !== 'object' || L.__mama) continue;
				if (!L.Moves && !L.Default) continue;
				L.Moves = L.Moves || {};
				L.Abilities = L.Abilities || {};
				L.Default = L.Default || {};
				poeNaTabela(L.Moves, D.moves);
				poeNaTabela(L.Abilities, D.habilidades);
				if (!L.Default.frb) L.Default.frb = frb;
				L.__mama = true;
			}
		}
		setTimeout(poeTextos, 1500);
	})();
})();
`;
	dadosCache.set(raiz, saida);
	return saida;
}

module.exports = { responder, dados, montar };
