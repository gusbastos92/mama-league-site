var JANELA_ANUNCIO_MS = 30 * 60 * 1000;
var REGEX_TRYCLOUDFLARE = /^https:\/\/([a-z0-9-]+\.trycloudflare\.com)\/?$/;

function hostValidoAuto(url) {
  var m = REGEX_TRYCLOUDFLARE.exec(url);
  return m ? m[1] : null;
}

function escolherServidor(opcoes) {
  var query = opcoes.query, anuncio = opcoes.anuncio, salvo = opcoes.salvo, agora = opcoes.agora;
  if (query) return { host: query, origem: 'query' };
  if (anuncio && agora - anuncio.visto <= JANELA_ANUNCIO_MS) {
    var host = hostValidoAuto(anuncio.url);
    if (host) return { host: host, origem: 'anuncio', quem: anuncio.quem };
  }
  if (salvo) return { host: salvo, origem: 'salvo' };
  return { host: null, origem: 'nenhum' };
}

var api = { escolherServidor: escolherServidor, hostValidoAuto: hostValidoAuto };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.MamaServidor = api;
