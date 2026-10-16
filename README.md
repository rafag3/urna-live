# Urna Live — jogo da urna para TikTok LIVE

Placar ao vivo entre dois números (padrão **13 x 22**). Comentário e presente da live viram voto, com a animação da urna digitando e confirmando cada voto.

## Requisitos
- Windows 10/11 com **Node.js 20+** (https://nodejs.org)
- OBS Studio ou TikTok LIVE Studio

## Instalação
```bash
npm install
```

## Testar sem live (modo simulado)
```bash
npm run sim
```
Abra `http://127.0.0.1:3000/` no navegador. Clique uma vez na página para liberar o som.

## Usar na live
1. O @ já está em `config.json` (`"tiktokUsername": "mazzeldigital"`, sem o @). Troque ali se for usar outro perfil.
2. **Comece a live primeiro**, depois rode `npm start`. Se rodar antes, ele fica tentando reconectar sozinho.
3. No OBS ou LIVE Studio, adicione uma **Fonte de Navegador**:
   - URL: `http://127.0.0.1:3000/`
   - Largura `1080`, Altura `1920`
   - Marque **"Controlar áudio via OBS"** para o som da urna sair na live.
4. O painel em `http://127.0.0.1:3000/admin` serve para zerar o placar, dar votos manuais e recarregar o config sem reiniciar.

## Live pelo celular (iPhone ou Android)
O TikTok no celular não aceita sobreposição de navegador como o OBS. O caminho é **transmitir a tela do celular** com o jogo aberto. O servidor continua rodando no PC, na mesma rede Wi-Fi.

1. No PC: `npm run lan`. O terminal mostra um link do tipo `http://192.168.x.x:3000/?k=abcd1234`.
2. No celular (mesmo Wi-Fi): abra esse link no Safari ou Chrome.
   - iPhone: Compartilhar → **Adicionar à Tela de Início**. Abrindo pelo ícone, o jogo fica em tela cheia, sem a barra do navegador.
   - Toque uma vez na tela para liberar o som e manter a tela acesa.
3. Ative o **Não Perturbe** para notificações não aparecerem na live.
4. No TikTok: LIVE → modo **Jogos / transmitir tela** → iniciar. Volte para o jogo.
5. Fale ou apareça de vez em quando: live 100% parada corre risco de restrição.

Se o Windows perguntar sobre o firewall na primeira vez, permita para **Redes privadas**. Não divulgue o link com `?k=`, porque quem tiver a chave consegue zerar o placar pelo painel. Sem PC, também dá para hospedar o servidor na nuvem, mas o TikTok costuma bloquear o conector vindo de IP de datacenter, então o PC em casa é o caminho mais confiável.

## Como o voto funciona
| Ação na live | Resultado |
|---|---|
| Comentar `13` ou `22` | +1 voto (no máximo 1 a cada 15 s por pessoa) |
| Presente com `"numero"` no config | vai direto para aquele time (Rose → 13, Daisy → 22) |
| Presente sem `"numero"` (TikTok) | vai para o último número que a pessoa digitou; se ela ainda não digitou, fica guardado 2 min esperando |
| Presente não listado | 1 voto por diamante, mesma regra do time |
| Últimos 60 s da rodada | votos valem **x5** (`multiplicadorFinal`) |

Sequência de presente (combo de rosas) conta só uma vez, no fim, com a quantidade total.

## Personalização (`config.json`)
- `opcoes[0]` é o lado **esquerdo**, `opcoes[1]` o **direito**: número, nome, cor e imagem.
- **Imagens:** coloque PNG com fundo transparente em `public/img/`: `time13.png` e `time22.png` (personagens), `icone13.png` e `icone22.png` (ícones de presente). Sem arquivo, aparece o escudo com o número ou o emoji.
- `fundo`: opcional, `img/fundo.png` para trocar o fundo vermelho/verde por uma imagem sua.
- `mostrarTotalDeVotos`: `false` deixa só a porcentagem.
- **Presentes:** a chave é o **nome em inglês exatamente como o TikTok manda** (`Rose`, `TikTok`, `Heart Me`…). Para descobrir o nome de um presente, olhe o terminal durante a live ou teste com um amigo mandando.
- `rodada.duracaoSegundos`: `0` desliga o timer.

O placar fica salvo em `state.json`; se o programa cair, ele volta de onde parou.

## Observações
- A conexão usa o `tiktok-live-connector`, **não oficial**. Quando o TikTok muda algo, ele pode parar até sair atualização (`npm update tiktok-live-connector`).
- Por padrão o servidor só aceita conexões da sua máquina (`127.0.0.1`). Com `npm run lan` ele abre para o Wi-Fi e exige a chave `?k=`.
- **Conteúdo político:** enquetes sobre a eleição são proibidas durante o período de campanha (Lei 9.504/97, art. 33, §5º) e o TikTok restringe presentes em conteúdo político. Não divulgue os presentes como "doação para candidato".
