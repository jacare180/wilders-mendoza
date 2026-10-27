# wilders-mendoza

App "Wilders em Mendoza": viagem de família (Beny, Alan e Ilana) de camper por Mendoza, 21/12/2026 a 04/01/2027. Feito a partir do sadosboets (jacare180/sadosboets), que continua no ar para Cape Town e não deve ser mexido.

## Arquitetura

- Netlify, deploy pelo repo GitHub jacare180/wilders-mendoza (público: no plano grátis, repo privado só aceita um contribuidor)
- `public/index.html`: app inteiro em um arquivo (HTML/CSS/JS puro). Rotas por hash: `#hoje`, `#roteiro` (Dias, Mapa, Água, Reservas), `#trilhas`, `#listas` (Checklist, Pendências), `#custos`, `#hotel`
- `public/sw.js`: service worker. Página com rede primeiro e cópia em cache sem sinal; fontes e fotos com cache primeiro
- `netlify/functions/api.mjs`: API com Netlify Blobs (store "wilders", consistência strong)
  - `GET /api/state` | `POST /api/write {op: set|update|delete, coll, id, data, who, log}` | `POST /api/import {dados, who}` | `POST /api/photo` | `GET /api/photo/:id`
  - Cada coleção é um blob só (`col/dias`, `col/pernoites`, `col/trilhas`, `col/checklist`, `col/pendencias`, `col/custos`, `col/hoteis`), mais `config` e `log`
  - `update` aceita chaves com ponto (`"curtidas.Alan": true`) para mexer num campo aninhado sem sobrescrever o resto
  - `import` guarda uma cópia em `backup/<timestamp>` antes de trocar tudo
- `data/viagem.json`: dados iniciais. A API semeia o Blobs com ele na primeira leitura (quando não existe `config`). Depois disso, editar o arquivo não muda o app: o caminho é editar pelo app ou usar "Carregar um arquivo de dados" no menu do nome
- Offline: o último estado fica no localStorage (`w_data`); mudanças feitas sem sinal entram numa fila (`w_queue`), aparecem na hora e são enviadas quando o sinal volta
- Um código só, na variável `KEY_WILDERS` do Netlify (contexto "all", variável comum, não secreta). Link: `/?k=CODIGO`; o código fica no localStorage e sai da barra de endereço. Sem código, a API não responde nada
- Sem perfis: cada pessoa toca no próprio nome uma vez (Beny, Alan, Ilana, vindo de `config.pessoas`). O nome assina o log ("Novidades" na aba Hoje), os itens adicionados e quem marcou cada coisa
- Ordem dos dias em `config.ordem`; a data de cada dia vem da posição a partir de `config.inicio`. Só dias da fase camper mudam de lugar. Trilhas apontam para o dia pelo id (`dia`), então vão junto
- Custos: `auto: "pernoites"` soma o preço dos pernoites dos dias de camper; `auto: "hotel"` usa o hotel escolhido na aba Hotel, ou a estimativa enquanto nenhum for escolhido. Câmbio editável em `config.cambio`
- `?hoje=AAAA-MM-DD` mostra o app como se fosse aquele dia (para testar)

## Regras de conteúdo

- Tudo em português, linguagem simples (a Ilana também usa)
- Sem travessões nos textos
- Identidade "Andes e sul vulcânico": fundo areia `#F3EADB`, texto basalto `#2B2623`, ação em vermelho vulcânico `#B4462B`, apoio céu andino `#3D6E8C`. Níveis: Fácil `#5E7D3A`, Moderada `#B87A10`, Difícil `#A63A2B`, sempre com texto e marcadores, nunca só cor. Fontes: Bitter (títulos) e Atkinson Hyperlegible (texto), base 17px
- Nada de número de documento no JSON ou no app: o repo é público
- Câmbio do grupo: US$ 1 = R$ 5,20; R$ 1 = ARS 200

## Regras da viagem (verificadas, não contradizer)

- Nunca dormir em posto ou beira de estrada; posto só como parada técnica de dia
- La Payunia exige guia; tarifa do parque por veículo (ARS 46.700). Acampe La Amarga: entrada a partir das 18h, saída até 12h
- Llancanelo: circuito parcial autoguiado; completo exige guia
- Aconcágua: só cartão e reserva antecipada
- Valle Grande municipal é só de dia; Vallecitos não permite pernoite de camper; Camping Municipal de Uspallata em reforma; Pincheira abre 24/12 e só aceita dinheiro; Laguna del Diamante fora (abre em janeiro)

## Deploy

- Cada push na `main` dispara o build. Deploy em produção custa 15 créditos e a conta do Netlify é a mesma do sadosboets (300 por ciclo, divididos entre os dois sites): juntar mudanças e publicar uma vez por rodada
- `netlify.toml` tem `ignore`: commit que só mexe fora de `public/`, `netlify/`, `data/`, `netlify.toml` e `package.json` não gera build
- Mudanças grandes primeiro numa branch (deploy de branch é grátis); a branch usa os mesmos dados do Blobs que produção

## Pendente

- Locadora do camper: nome, contato, local e horário de retirada e devolução
- Km de alguns trechos são estimativa (marcados no app); conferir no Google Maps
- Opções de hotel para 02 e 03/01
