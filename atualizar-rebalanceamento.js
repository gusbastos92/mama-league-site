#!/usr/bin/env node
/**
 * Monta o mod da MAMA League direto da planilha principal ("documentação") no Google Sheets.
 *
 *   node atualizar-rebalanceamento.js          (dentro da pasta pokemon-showdown; o atualizar.bat roda isto)
 *
 * Lê as abas (pelo nome):
 *   "Rebalanceamento dos pokemons"  tipos, stats, habilidades e a coluna de modificações nos TMs
 *   "Moveset dos pokemons"          os blocos LEVEL_UP_MOVE (moves por nível)
 *   "TMs por Pokémon"               os TMs de cada um
 * Entram no simulador só os Pokémon que estão na aba Rebalanceamento.
 * As exclusividades da liga (Frostbite, golpes e habilidades novos ou modificados) ficam programadas aqui embaixo,
 * em EXCLUSIVAS (é código: muda só quando a regra mudar).
 * Grava só em data/mods/mamaleague/ e config/custom-formats.ts.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const VERSAO_CONFIG = 3;
const CONFIG_PADRAO = {
	versao: VERSAO_CONFIG,
	planilha: '13y-oKjuTQcLbgdx5mFtMJF_rGiCtmao-UK9fVRpyX5M',
	abas: { rebalanceamento: 'Rebalanceamento dos pokemons', moveset: 'Moveset dos pokemons', tms: 'TMs por Pokémon' },
	nivel: 61,              // nível dos formatos "Nv." e Doubles (o mesmo da calculadora da liga)
	terastal: false,
	soMamaLeague: true,             // esconde os formatos oficiais do Showdown (só a MAMA League aparece)
	aplicarModificacoesTMs: true,   // aplica a coluna "modificação nos TMs" (Retirar / Adicionar) da aba Rebalanceamento
};

const toID = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
	.replace(/♀/g, 'f').replace(/♂/g, 'm').replace(/[^a-z0-9]+/g, '');

function lerConfig() {
	const arq = path.join(__dirname, 'mama-config.json');
	let c = {};
	if (fs.existsSync(arq)) {
		try { c = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { c = {}; }
	}
	if (c.versao !== VERSAO_CONFIG) {   // config antiga (planilha de Rebalanceamento antiga): troca pela nova
		c = Object.assign({}, CONFIG_PADRAO);
		fs.writeFileSync(arq, JSON.stringify(c, null, '\t') + '\n');
	}
	return Object.assign({}, CONFIG_PADRAO, c, { abas: Object.assign({}, CONFIG_PADRAO.abas, c.abas || {}) });
}

// CSV com aspas, vírgulas e quebras de linha dentro das células
function csv(texto) {
	const linhas = [];
	let linha = [], cel = '', aspas = false;
	for (let i = 0; i < texto.length; i++) {
		const c = texto[i];
		if (aspas) {
			if (c === '"' && texto[i + 1] === '"') { cel += '"'; i++; } else if (c === '"') aspas = false; else cel += c;
		} else if (c === '"') aspas = true;
		else if (c === ',') { linha.push(cel); cel = ''; }
		else if (c === '\n') { linha.push(cel.replace(/\r$/, '')); linhas.push(linha); linha = []; cel = ''; }
		else cel += c;
	}
	if (cel || linha.length) { linha.push(cel); linhas.push(linha); }
	return linhas;
}

async function baixa(cfg, aba) {
	const nome = cfg.abas[aba];
	const url = `https://docs.google.com/spreadsheets/d/${cfg.planilha}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(nome)}`;
	const r = await fetch(url, { redirect: 'follow' });
	const txt = await r.text();
	if (!r.ok || /^\s*<(!doctype|html)/i.test(txt)) {
		throw new Error(`Não consegui ler a aba "${nome}" (${r.status}). A planilha está pública ("qualquer pessoa com o link") e a aba tem esse nome?`);
	}
	return txt;
}

// nomes e ids dos dados do próprio Showdown (lidos do código, sem precisar compilar)
function lerShowdown(arquivo) {
	const txt = fs.readFileSync(path.join(__dirname, 'data', arquivo), 'utf8');
	const out = new Map();
	const re = /^\t(\w+): \{\r?\n([\s\S]*?)^\t\},?\r?$/gm;
	let m;
	while ((m = re.exec(txt))) {
		const nome = /^\t\tname: "([^"]+)"/m.exec(m[2]);
		out.set(m[1], { nome: nome ? nome[1] : m[1] });
	}
	return out;
}

function distancia(a, b) {
	const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
	for (let j = 1; j <= b.length; j++) d[0][j] = j;
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
	}
	return d[a.length][b.length];
}

async function main() {
	const cfg = lerConfig();
	const avisos = [];
	console.log('Lendo a planilha principal da MAMA League…');
	const [tRebal, tMoveset, tTms] = await Promise.all(['rebalanceamento', 'moveset', 'tms'].map((a) => baixa(cfg, a)));
	const Pokedex = lerShowdown('pokedex.ts');
	const Moves = lerShowdown('moves.ts');
	const Abilities = lerShowdown('abilities.ts');
	const habPorId = new Map([...Abilities].map(([id, a]) => [id, a.nome]));
	for (const [id, h] of Object.entries(EXCLUSIVAS.habilidadesNovas)) habPorId.set(id, h.name);
	const moveExiste = (id) => Moves.has(id) || id in EXCLUSIVAS.golpesNovos;

	// ---- habilidades: acha o nome oficial (corrige erros de digitação)
	const corrigidas = new Map(), desconhecidas = new Set();
	const habilidade = (bruto) => {
		const limpo = String(bruto || '').replace(/^\s*ABILITY_/i, '').replace(/_/g, ' ').trim();
		const id = toID(limpo);
		if (!id) return '';
		if (habPorId.has(id)) return habPorId.get(id);
		let melhor = null, dm = 99;
		for (const [hid, nome] of habPorId) {
			const dd = distancia(id, hid);
			if (dd < dm) { dm = dd; melhor = nome; }
		}
		if (melhor && dm <= Math.max(2, Math.floor(id.length / 4))) { corrigidas.set(limpo, melhor); return melhor; }
		desconhecidas.add(limpo);
		return '';
	};
	// "ABILITY_A | ABILITY_B | HA: ABILITY_C", "ABILITY_A | ABILITY_B (sem H.A.)", "ABILITY_A (apenas)"
	const habilidades = (texto) => {
		const t = String(texto || '').replace(/\([^)]*\)/g, '').trim();
		if (!t) return null;
		const normais = [], ocultas = [];
		for (let p of t.split(/\|/)) {
			p = p.trim();
			if (!p) continue;
			const ha = /^H\.?A\.?\s*:\s*(.+)$/i.exec(p);
			const nome = habilidade(ha ? ha[1] : p);
			if (nome) (ha ? ocultas : normais).push(nome);
		}
		const lista = normais.filter((h, i) => normais.indexOf(h) === i);
		if (!lista.length && !ocultas.length) return null;
		const ab = { 0: lista[0] || ocultas[0] };
		if (lista[1]) ab[1] = lista[1];
		if (ocultas.length && ocultas[0] !== ab[0] && ocultas[0] !== ab[1]) ab.H = ocultas[0];
		return ab;
	};

	// ---- Pokémon (aba Rebalanceamento)
	const rebal = csv(tRebal);
	let iCab = rebal.findIndex((l) => l.some((c) => toID(c) === 'name'));
	if (iCab < 0) iCab = 0;
	const cab = rebal[iCab].map((c) => toID(c));
	const col = (...nomes) => { for (const n of nomes) { const i = cab.findIndex((c) => c === n || c.startsWith(n)); if (i >= 0) return i; } return -1; };
	const C = { nome: col('name'), t1: col('type1'), t2: col('type2'), hp: col('hp'), atk: col('attack'), def: col('defense'),
		spe: col('speed'), spa: col('spatk'), spd: col('spdef'), hab: col('ability'), tms: cab.findIndex((c) => c.includes('tms')) };
	const tipos = ['Normal', 'Fire', 'Water', 'Grass', 'Electric', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock',
		'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'];
	const tipo = (t) => tipos.find((x) => x.toLowerCase() === String(t || '').trim().toLowerCase()) || '';
	const pokedex = {}, prontos = [], nomeDe = new Map(), modTMs = new Map(), semHab = [];
	for (const r of rebal.slice(iCab + 1)) {
		const bruto = (r[C.nome] || '').trim();
		if (!bruto) continue;
		const id = toID(bruto.replace(/^SPECIES_/i, ''));
		if (!id || pokedex[id]) continue;
		if (!Pokedex.has(id)) { avisos.push(`"${bruto}" não existe no Showdown com esse nome: ficou de fora.`); continue; }
		const e = { inherit: true };
		const ts = [tipo(r[C.t1]), tipo(r[C.t2])].filter(Boolean).filter((t, i, a) => a.indexOf(t) === i);
		if (ts.length) e.types = ts;
		const st = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map((k) => Math.round(parseFloat(r[C[k]])));
		if (st.every((v) => v > 0)) e.baseStats = { hp: st[0], atk: st[1], def: st[2], spa: st[3], spd: st[4], spe: st[5] };
		else avisos.push(`${bruto}: stats incompletos na planilha (ficaram os do jogo original).`);
		const ab = habilidades(r[C.hab]);
		if (ab) e.abilities = ab; else semHab.push(bruto);
		pokedex[id] = e;
		prontos.push(id);
		nomeDe.set(id, Pokedex.get(id).nome);
		if (C.tms >= 0 && (r[C.tms] || '').trim()) modTMs.set(id, r[C.tms].trim());
	}
	if (semHab.length) avisos.push(`Habilidade em branco (ficaram as originais): ${semHab.join(', ')}.`);

	// ---- learnsets por nível (aba Moveset: blocos "static const struct LevelUpMove s<Nome>LevelUpLearnset[]")
	const learnsets = {};
	const movesDesconhecidos = new Map();
	const garante = (id) => (learnsets[id] ||= { learnset: {} }).learnset;
	const poe = (id, move, fonte) => {
		const mid = toID(String(move).replace(/^MOVE_/, ''));
		if (!moveExiste(mid)) { movesDesconhecidos.set(mid, (movesDesconhecidos.get(mid) || 0) + 1); return; }
		const ls = garante(id);
		if (!ls[mid]) ls[mid] = [];
		if (!ls[mid].includes(fonte)) ls[mid].push(fonte);
	};
	const tira = (id, move) => {
		const mid = toID(move);
		const ls = learnsets[id] && learnsets[id].learnset;
		if (!ls || !ls[mid]) return false;
		ls[mid] = ls[mid].filter((f) => f !== '9M');
		if (!ls[mid].length) delete ls[mid];
		return true;
	};
	let atual = null;
	const semBloco = new Set(prontos);
	for (const linha of tMoveset.split(/\r?\n/)) {
		const b = /s(\w+?)LevelUpLearnset\[\]/.exec(linha);
		if (b) {
			const id = toID(b[1]);
			atual = pokedex[id] ? id : null;
			if (atual) { garante(atual); semBloco.delete(atual); }
			continue;
		}
		if (!atual) continue;
		for (const m of linha.matchAll(/LEVEL_UP_MOVE\(\s*(\d+)\s*,\s*(MOVE_\w+)\s*\)/g)) poe(atual, m[2], '9L' + Math.max(1, +m[1]));
	}
	for (const id of semBloco) avisos.push(`${nomeDe.get(id)}: sem moves por nível na aba Moveset.`);

	// ---- TMs (aba TMs por Pokémon) + a coluna de modificações da aba Rebalanceamento
	const comTM = new Set();
	for (const r of csv(tTms).slice(1)) {
		const id = toID(r[0]);
		if (!pokedex[id]) continue;
		const lista = (r[1] || '').match(/MOVE_\w+/g) || [];
		lista.forEach((m) => poe(id, m, '9M'));
		if (lista.length) comTM.add(id);
	}
	for (const id of prontos) if (!comTM.has(id)) avisos.push(`${nomeDe.get(id)}: sem TMs na aba TMs por Pokémon.`);
	const mudancasTM = [];
	if (cfg.aplicarModificacoesTMs) {
		for (const [id, texto] of modTMs) {
			for (const parte of texto.split(/(?=\b(?:Retirar|Remover|Adicionar)\b)/i)) {
				const acao = /^\s*(Retirar|Remover|Adicionar)/i.exec(parte);
				if (!acao) continue;
				const add = /adicionar/i.test(acao[1]);
				for (const m of parte.matchAll(/([A-Za-z][A-Za-z .'-]*?)\s*\(TM\s*\d*\)/g)) {
					const nome = m[1].replace(/^\s*(Retirar|Remover|Adicionar|e)\s+/i, '').replace(/^\s*e\s+/i, '').trim();
					const mid = toID(nome);
					if (!mid) continue;
					if (add) {
						if (!moveExiste(mid)) { avisos.push(`${nomeDe.get(id)}: "Adicionar ${nome}" — move desconhecido.`); continue; }
						poe(id, mid, '9M');
						mudancasTM.push(`${nomeDe.get(id)} +${nome}`);
					} else if (tira(id, mid)) {
						mudancasTM.push(`${nomeDe.get(id)} −${nome}`);
					}
				}
			}
		}
	}
	for (const [mid, n] of movesDesconhecidos) avisos.push(`Move "${mid}" (${n}x) não existe no Showdown nem nas exclusividades: ficou de fora.`);
	for (const h of desconhecidas) avisos.push(`Habilidade "${h}" não existe no Showdown nem nas exclusividades: ficou de fora.`);
	for (const [de, para] of corrigidas) avisos.push(`Habilidade "${de}" lida como "${para}".`);

	// ---- grava
	const hoje = new Date().toISOString().slice(0, 10);
	const cabTxt = `// Gerado da planilha principal da MAMA League (${hoje}). Não edite à mão: rode o atualizar.bat de novo.\n`;
	const ts = (nome, tipoTs, obj) => cabTxt + `export const ${nome}: ${tipoTs} = ` + JSON.stringify(obj, null, '\t') + ';\n';
	const arquivos = {
		'data/mods/mamaleague/scripts.ts': cabTxt + EXCLUSIVAS.scripts,
		'data/mods/mamaleague/conditions.ts': cabTxt + EXCLUSIVAS.conditions,
		'data/mods/mamaleague/moves.ts': cabTxt + EXCLUSIVAS.moves,
		'data/mods/mamaleague/abilities.ts': cabTxt + EXCLUSIVAS.abilities,
		'data/mods/mamaleague/pokedex.ts': ts('Pokedex', "import('../../../sim/dex-species').ModdedSpeciesDataTable", pokedex),
		'data/mods/mamaleague/learnsets.ts': ts('Learnsets', "import('../../../sim/dex-species').ModdedLearnsetDataTable", learnsets),
		'config/custom-formats.ts': formatos(cabTxt, prontos, cfg),
	};
	for (const [rel, conteudo] of Object.entries(arquivos)) {
		const destino = path.join(__dirname, ...rel.split('/'));
		fs.mkdirSync(path.dirname(destino), { recursive: true });
		fs.writeFileSync(destino, conteudo);
		console.log('  ✓', rel);
	}
	console.log(`\n${prontos.length} Pokémon · ${Object.keys(learnsets).length} learnsets · ` +
		`${mudancasTM.length} mudanças de TM aplicadas da coluna "modificação nos TMs"`);
	if (mudancasTM.length) console.log('  ' + mudancasTM.join(', '));
	console.log('Exclusividades programadas: Frostbite, Creeping Chill, Abrasive Rock, Cut, Cotton Spore, Steel Roller, X-Scissor, ' +
		'Aurora Beam, Sky Drop, Pyrotechnist, Fable, Enervate, Cloud Nine, Torrent/Blaze/Overgrow/Swarm, Truant.');
	if (avisos.length) {
		console.log(`\nAvisos (${avisos.length}):`);
		for (const a of avisos) console.log('  -', a);
	}
	fs.writeFileSync(path.join(__dirname, 'mama-avisos.txt'), avisos.join('\n') + '\n');
	console.log('\nPronto. Reinicie o servidor para valer (feche a janela do iniciar.bat e abra de novo).');
}

function formatos(cab, especies, cfg) {
	// A MAMA League não usa EVs: "EV Limit = 0" (sem o aviso de "0 EVs" e recusa time com EV)
	const semEV = cfg.semEV === false ? [] : ['!! EV Limit = 0'];
	const base = ['Standard NatDex'].concat(cfg.terastal ? [] : ['Terastal Clause'], semEV);
	const nv = `Adjust Level = ${cfg.nivel}`;
	const lista = [
		{ name: '[Gen 9] MAMA League', desc: 'Singles com os Pokémon da MAMA League, no nível do time.', ruleset: base },
		{ name: '[Gen 9] MAMA League Doubles', desc: `Batalha em dupla, com todos no nível ${cfg.nivel} (como a calculadora da liga).`,
			gameType: 'doubles', ruleset: base.concat([nv]) },
		{ name: '[Gen 9] MAMA League Livre', desc: 'Sem cláusulas, no nível do time (bom para revanche do Nuzlocke).',
			ruleset: ['Obtainable', '+Unobtainable', '+Past', 'Team Preview', 'HP Percentage Mod', 'Cancel Mod'].concat(cfg.terastal ? [] : ['Terastal Clause'], semEV) },
	];
	const corpo = lista.map((f) => {
		const o = Object.assign({ name: f.name, desc: f.desc }, f.gameType ? { gameType: f.gameType } : {}, { mod: 'mamaleague', ruleset: f.ruleset });
		return '\t' + JSON.stringify(o, null, '\t').replace(/\n\}$/, ',\n\tonValidateSet: mamaLeague,\n}').replace(/\n/g, '\n\t');
	}).join(',\n');
	const esconder = cfg.soMamaLeague === false ? '' :
		"import { Formats as OFICIAIS } from './formats';\n\n" +
		'// Só os formatos da MAMA League aparecem na lista (os oficiais ficam escondidos). Para mostrar todos de novo,\n' +
		'// ponha "soMamaLeague": false no mama-config.json e rode o atualizar.bat.\n' +
		'for (const f of OFICIAIS as any[]) {\n' +
		'\tif (f.name) { f.searchShow = false; f.challengeShow = false; f.tournamentShow = false; }\n' +
		'}\n\n';
	return cab + esconder +
		'// Pokémon da MAMA League (aba Rebalanceamento da planilha)\n' +
		'const ESPECIES = new Set(' + JSON.stringify(especies) + ');\n\n' +
		'function mamaLeague(this: any, set: any) {\n' +
		'\tconst species = this.dex.species.get(set.species || set.name);\n' +
		'\tif (ESPECIES.has(species.id)) return [];\n' +
		'\treturn [`${species.name} não está na MAMA League.`];\n' +
		'}\n\n' +
		"export const Formats: import('../sim/dex-formats').FormatList = [\n" +
		'\t{\n\t\tsection: "MAMA League",\n\t\tcolumn: 1,\n\t},\n' + corpo + ',\n];\n';
}

/* =====================================================================================================================
 * EXCLUSIVAS DA MAMA LEAGUE (aba "exclusividades da liga")
 * Valores que a planilha deixou "a definir" e que o simulador precisa ter (estão marcados com A DEFINIR):
 *   Frostbite: sem duração (fica até ser curado, como Burn). Ice é imune (como era com Freeze).
 *   Creeping Chill: 20 PP, alvo único, prioridade 0.     Abrasive Rock: 100% de precisão, 15 PP, alvo único, prioridade 0.
 *   Truant: "golpe de recuperação" = golpe com a marca "heal" do Showdown (Recover, Roost, Rest, Synthesis, Drain Punch não).
 * ===================================================================================================================== */
const EXCLUSIVAS = {
	golpesNovos: { creepingchill: 1, abrasiverock: 1 },
	habilidadesNovas: { pyrotechnist: { name: 'Pyrotechnist' }, fable: { name: 'Fable' }, enervate: { name: 'Enervate' } },

	scripts: `export const Scripts: ModdedBattleScriptsData = {
	gen: 9,
	inherit: 'gen9',
	init() {
		// Frostbite substitui Freeze: todo golpe que congelava passa a causar Frostbite
		const troca = (sec: any) => {
			if (!sec) return;
			if (sec.status === 'frz') sec.status = 'frb';
		};
		for (const id in this.data.Moves) {
			const m = this.data.Moves[id] as any;
			const temFrz = m.status === 'frz' || m.secondary?.status === 'frz' ||
				(m.secondaries || []).some((s: any) => s?.status === 'frz');
			if (!temFrz) continue;
			const nova = this.modData('Moves', id) as any;
			if (nova.status === 'frz') nova.status = 'frb';
			troca(nova.secondary);
			(nova.secondaries || []).forEach(troca);
		}
		// Ice é imune a Frostbite (como era a Freeze)
		const ice = this.modData('TypeChart', 'ice') as any;
		ice.damageTaken = { ...ice.damageTaken, frb: 3 };
	},
};
`,

	conditions: `export const Conditions: import('../../../sim/dex-conditions').ModdedConditionDataTable = {
	frb: {
		name: 'frb',
		effectType: 'Status',
		onStart(target, source, sourceEffect) {
			if (sourceEffect?.effectType === 'Ability') {
				this.add('-status', target, 'frb', '[from] ability: ' + sourceEffect.name, \`[of] \${source}\`);
			} else {
				this.add('-status', target, 'frb');
			}
		},
		// metade do dano dos golpes especiais (como a Burn faz com os físicos)
		onModifyDamage(damage, source, target, move) {
			if (move.category === 'Special') return this.chainModify(0.5);
		},
		// 1/16 do HP no fim do turno
		onResidualOrder: 10,
		onResidual(pokemon) {
			this.damage(pokemon.baseMaxhp / 16);
		},
	},
};
`,

	moves: `export const Moves: import('../../../sim/dex-moves').ModdedMoveDataTable = {
	// ---------- golpes novos
	creepingchill: {
		num: -3001,
		accuracy: 85,
		basePower: 0,
		category: 'Status',
		name: 'Creeping Chill',
		pp: 20,                 // A DEFINIR na planilha
		priority: 0,
		flags: { protect: 1, reflectable: 1, mirror: 1, metronome: 1 },
		status: 'frb',
		secondary: null,
		target: 'normal',
		type: 'Ice',
		desc: "Inflicts frostbite on the target.",
		shortDesc: "Frostbites the target.",
	},
	abrasiverock: {
		num: -3002,
		accuracy: 100,          // A DEFINIR na planilha
		basePower: 70,
		category: 'Physical',
		name: 'Abrasive Rock',
		pp: 15,                 // A DEFINIR na planilha
		priority: 0,
		flags: { protect: 1, mirror: 1, metronome: 1 },
		onEffectiveness(typeMod, target, type) {
			if (type === 'Steel') return 1;
		},
		secondary: null,
		target: 'normal',
		type: 'Rock',
		desc: "This move's type effectiveness against Steel is changed to be super effective no matter what this move's type is.",
		shortDesc: "Super effective on Steel.",
	},
	// ---------- golpes modificados
	cut: {
		inherit: true,
		type: 'Steel',
		desc: "No additional effect.",
		shortDesc: "No additional effect.",
	},
	cottonspore: {
		inherit: true,
		accuracy: 95,
		basePower: 55,
		category: 'Physical',
		pp: 15,
		priority: 0,
		flags: { protect: 1, mirror: 1, metronome: 1, wind: 1 },
		boosts: undefined,
		zMove: undefined,
		secondary: {
			chance: 100,
			boosts: { spe: -1 },
		},
		target: 'allAdjacentFoes',
		type: 'Grass',
		desc: "Has a 100% chance to lower the target's Speed by 1 stage.",
		shortDesc: "100% chance to lower the foe(s) Speed by 1.",
	},
	steelroller: {
		inherit: true,
		basePower: 80,
		onTry: undefined,
		onHit: undefined,
		onAfterHit(target, source) {
			if (source.hp) this.field.clearTerrain();
		},
		onAfterSubDamage(damage, target, source) {
			if (source.hp) this.field.clearTerrain();
		},
		desc: "If this move is successful and the user has not fainted, the effects of Electric Terrain, Grassy Terrain, Misty Terrain, and Psychic Terrain end.",
		shortDesc: "Ends the effects of terrain.",
	},
	xscissor: {
		inherit: true,
		onAfterHit(target, source) {
			if (source.hp) this.field.clearTerrain();
		},
		onAfterSubDamage(damage, target, source) {
			if (source.hp) this.field.clearTerrain();
		},
		desc: "If this move is successful and the user has not fainted, the effects of Electric Terrain, Grassy Terrain, Misty Terrain, and Psychic Terrain end.",
		shortDesc: "Ends the effects of terrain.",
	},
	aurorabeam: {
		inherit: true,
		accuracy: 100,
		basePower: 80,
		category: 'Special',
		pp: 15,
		secondary: {
			chance: 30,
			status: 'frb',
		},
		type: 'Ice',
		desc: "Has a 30% chance to frostbite the target.",
		shortDesc: "30% chance to frostbite the target.",
	},
	skydrop: {
		inherit: true,
		isNonstandard: null,
		accuracy: 100,
		basePower: 80,
		category: 'Physical',
		pp: 15,
		priority: 0,
		flags: { contact: 1, protect: 1, mirror: 1, metronome: 1 },
		onModifyMove: undefined,
		onMoveFail: undefined,
		onTry: undefined,
		onTryHit: undefined,
		onHit: undefined,
		condition: undefined,
		tracksTarget: undefined,
		secondary: {
			chance: 30,
			status: 'frb',
		},
		target: 'normal',
		type: 'Flying',
		desc: "Has a 30% chance to frostbite the target.",
		shortDesc: "30% chance to frostbite the target.",
	},
	triattack: {
		inherit: true,
		secondary: {
			chance: 20,
			onHit(target, source) {
				const result = this.random(3);
				if (result === 0) target.trySetStatus('brn', source);
				else if (result === 1) target.trySetStatus('par', source);
				else target.trySetStatus('frb', source);
			},
		},
		desc: "Has a 20% chance to either burn, paralyze, or frostbite the target.",
		shortDesc: "20% chance to paralyze or burn or frostbite target.",
	},
};
`,

	abilities: `export const Abilities: import('../../../sim/dex-abilities').ModdedAbilityDataTable = {
	// ---------- habilidades novas
	pyrotechnist: {
		num: -3001,
		name: 'Pyrotechnist',
		rating: 3.5,
		flags: {},
		onModifyAtkPriority: 5,
		onModifyAtk(atk, attacker, defender, move) {
			if (move.type === 'Fire') return this.chainModify(1.5);
		},
		onModifySpAPriority: 5,
		onModifySpA(atk, attacker, defender, move) {
			if (move.type === 'Fire') return this.chainModify(1.5);
		},
		desc: "This Pokemon's offensive stat is multiplied by 1.5 while using a Fire-type attack.",
		shortDesc: "This Pokemon's attacking stat is multiplied by 1.5 while using a Fire-type attack.",
	},
	fable: {
		num: -3002,
		name: 'Fable',
		rating: 3,
		flags: {},
		onStart(pokemon) {
			this.add('-ability', pokemon, 'Fable');
			this.field.clearWeather();
			this.field.clearTerrain();
			for (const mon of this.getAllActive()) mon.clearBoosts();
			this.add('-clearallboost');
		},
		desc: "On switch-in, this Pokemon ends the effects of weather and terrain, and the stat stages of all active Pokemon are reset to 0.",
		shortDesc: "On switch-in, ends weather and terrain and clears all stat changes.",
	},
	enervate: {
		num: -3003,
		name: 'Enervate',
		rating: 3.5,
		flags: {},
		onStart(pokemon) {
			let activated = false;
			for (const target of pokemon.adjacentFoes()) {
				if (!activated) {
					this.add('-ability', pokemon, 'Enervate', 'boost');
					activated = true;
				}
				if (target.volatiles['substitute']) {
					this.add('-immune', target);
				} else {
					this.boost({ spa: -1 }, target, pokemon, null, true);
				}
			}
		},
		desc: "On switch-in, this Pokemon lowers the Special Attack of opposing Pokemon by 1 stage. Pokemon behind a substitute are immune.",
		shortDesc: "On switch-in, this Pokemon lowers the Sp. Atk of opponents by 1 stage.",
	},
	// ---------- habilidades modificadas
	cloudnine: {
		inherit: true,
		// o onSwitchIn original já mostra a habilidade e chama este onStart
		onStart(pokemon) {
			pokemon.abilityState.ending = false;
			this.field.clearWeather();
			this.field.clearTerrain();
			this.eachEvent('WeatherChange', this.effect);
		},
		desc: "On switch-in, this Pokemon ends the effects of weather and terrain. While this Pokemon is active, the effects of weather conditions are disabled.",
		shortDesc: "On switch-in, ends weather and terrain. While active, weather has no effect.",
	},
	overgrow: {
		inherit: true,
		onModifyAtk(atk, attacker, defender, move) {
			if (move.type === 'Grass' && attacker.hp <= attacker.maxhp / 2) return this.chainModify(1.5);
		},
		onModifySpA(atk, attacker, defender, move) {
			if (move.type === 'Grass' && attacker.hp <= attacker.maxhp / 2) return this.chainModify(1.5);
		},
		desc: "When this Pokemon has 1/2 or less of its maximum HP, rounded down, its offensive stat is multiplied by 1.5 while using a Grass-type attack.",
		shortDesc: "At 1/2 or less of its max HP, this Pokemon's offensive stat is 1.5x with Grass attacks.",
	},
	blaze: {
		inherit: true,
		onModifyAtk(atk, attacker, defender, move) {
			if (move.type === 'Fire' && attacker.hp <= attacker.maxhp / 2) return this.chainModify(1.5);
		},
		onModifySpA(atk, attacker, defender, move) {
			if (move.type === 'Fire' && attacker.hp <= attacker.maxhp / 2) return this.chainModify(1.5);
		},
		desc: "When this Pokemon has 1/2 or less of its maximum HP, rounded down, its offensive stat is multiplied by 1.5 while using a Fire-type attack.",
		shortDesc: "At 1/2 or less of its max HP, this Pokemon's offensive stat is 1.5x with Fire attacks.",
	},
	torrent: {
		inherit: true,
		onModifyAtk(atk, attacker, defender, move) {
			if (move.type === 'Water' && attacker.hp <= attacker.maxhp / 2) return this.chainModify(1.5);
		},
		onModifySpA(atk, attacker, defender, move) {
			if (move.type === 'Water' && attacker.hp <= attacker.maxhp / 2) return this.chainModify(1.5);
		},
		desc: "When this Pokemon has 1/2 or less of its maximum HP, rounded down, its offensive stat is multiplied by 1.5 while using a Water-type attack.",
		shortDesc: "At 1/2 or less of its max HP, this Pokemon's offensive stat is 1.5x with Water attacks.",
	},
	swarm: {
		inherit: true,
		onModifyAtk(atk, attacker, defender, move) {
			if (move.type === 'Bug' && attacker.hp <= attacker.maxhp / 2) return this.chainModify(1.5);
		},
		onModifySpA(atk, attacker, defender, move) {
			if (move.type === 'Bug' && attacker.hp <= attacker.maxhp / 2) return this.chainModify(1.5);
		},
		desc: "When this Pokemon has 1/2 or less of its maximum HP, rounded down, its offensive stat is multiplied by 1.5 while using a Bug-type attack.",
		shortDesc: "At 1/2 or less of its max HP, this Pokemon's offensive stat is 1.5x with Bug attacks.",
	},
	truant: {
		inherit: true,
		onBeforeMove(pokemon, target, move) {
			if (pokemon.removeVolatile('truant')) {
				if (move.flags['heal']) return;   // no turno de descanso, golpe de recuperação pode
				this.add('cant', pokemon, 'ability: Truant');
				return false;
			}
			pokemon.addVolatile('truant');
		},
		desc: "This Pokemon skips every other turn instead of using a move. On those turns, it can still use a move that restores HP.",
		shortDesc: "This Pokemon skips every other turn, but can still use healing moves on those turns.",
	},
};
`,
};

// No Windows, recria o atalho "MAMA League" (Pokégear) na área de trabalho.
// Fica aqui porque o atualizar.bat antigo roda esta versão nova do arquivo:
// assim o atalho aparece já na primeira atualização.
function criarAtalho() {
	if (process.platform !== 'win32') return;
	const fs = require('fs'), path = require('path');
	const ps = [path.join(__dirname, '..', 'criar-atalho.ps1'), path.join(__dirname, 'criar-atalho.ps1')].find((f) => fs.existsSync(f));
	if (!ps) return;
	const r = require('child_process').spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps], { stdio: 'inherit' });
	if (r.status !== 0) console.log('Não consegui criar o atalho MAMA League (use o iniciar.bat).');
}

main().then(criarAtalho).catch((e) => { console.error('\nErro:', e.message); process.exit(1); });
