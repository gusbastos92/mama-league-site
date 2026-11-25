# Site fixo da MAMA League

Site da liga: https://gusbastos92.github.io/mama-league-site/

O site é reconstruído a cada hora a partir da planilha da liga (e a cada push). Ele publica o porteiro (`index.html`), o Teambuilder (`jogar.html`) e os dados da liga (`mama-dados.js`) no GitHub Pages.

Não edite os scripts aqui: eles vêm do kit (`sincronizar-site.js`, no repositório do kit). Para mudar um script, mude no kit e rode `node sincronizar-site.js`.

Arquivos de configuração:
- `site.json`: endereço do anúncio (o Apps Script de anúncio dos servidores).
- `showdown-ref.txt`: commit do Pokémon Showdown usado no build.
