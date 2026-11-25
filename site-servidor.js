var JANELA_ANUNCIO_MS = 30 * 60 * 1000;
var REGEX_TRYCLOUDFLARE = /^https:\/\/((?!api\.)[a-z0-9-]+\.trycloudflare\.com)\/?$/;

// tira https://, tudo depois da primeira / e maiúsculas (quem cola o endereço inteiro)
function normalizarHost(t) {
  return String(t == null ? '' : t).trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
}

function hostValidoAuto(url) {
  var m = REGEX_TRYCLOUDFLARE.exec(url);
  return m ? m[1] : null;
}

function escolherServidor(opcoes) {
  var query = normalizarHost(opcoes.query), anuncio = opcoes.anuncio, salvo = opcoes.salvo, agora = opcoes.agora;
  if (query) return { host: query, origem: 'query' };
  if (anuncio && agora - anuncio.visto <= JANELA_ANUNCIO_MS) {
    var host = hostValidoAuto(anuncio.url);
    if (host) return { host: host, origem: 'anuncio', quem: anuncio.quem };
  }
  // anúncio carregado (vazio, vencido ou inválido) = não há servidor; só usa o salvo se a busca falhou
  if (anuncio === null && salvo) return { host: salvo, origem: 'salvo' };
  return { host: null, origem: 'nenhum' };
}

var api = { escolherServidor: escolherServidor, hostValidoAuto: hostValidoAuto, normalizarHost: normalizarHost };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.MamaServidor = api;
