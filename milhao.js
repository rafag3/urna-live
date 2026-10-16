'use strict';
/**
 * "Rumo ao Milhão": quiz de eliminação com escada de prêmios (em PONTOS, sem dinheiro real).
 *
 * Rodada = 10 perguntas A/B/C/D com dificuldade crescente.
 *  - Entra no jogo quem responder até a pergunta `entradaAte` (padrão 3).
 *  - Errou = eliminado (a não ser que tenha vida extra). Não responder não elimina.
 *  - Presente = +1 vida extra; se a pessoa estiver eliminada, volta ao jogo.
 *  - Quem estiver vivo e acertar a última pergunta ganha o "milhão".
 *  - Sem ninguém vivo depois da fase de entrada, a rodada termina e mostra quem foi mais longe.
 */

const ESCADA = [
  { valor: 1e3, rot: '1 MIL' }, { valor: 2e3, rot: '2 MIL' }, { valor: 5e3, rot: '5 MIL' },
  { valor: 1e4, rot: '10 MIL' }, { valor: 2e4, rot: '20 MIL' }, { valor: 5e4, rot: '50 MIL' },
  { valor: 1e5, rot: '100 MIL' }, { valor: 2e5, rot: '200 MIL' }, { valor: 5e5, rot: '500 MIL' },
  { valor: 1e6, rot: '1 MILHÃO' },
];
// nível de dificuldade por degrau (1 = fácil, 2 = médio, 3 = difícil)
const NIVEL_DO_DEGRAU = [1, 1, 1, 2, 2, 2, 2, 3, 3, 3];
const LETRAS = ['A', 'B', 'C', 'D'];
// só a letra (ou "letra X"), opcionalmente com pontuação/emoji depois: "B", "c!!", "letra d", "2 🔥"
// "a resposta é c" NÃO conta (o "a" ali é artigo)
const RE_LETRA = /^\s*(?:letra\s+)?([abcd1-4])[^\p{L}\p{N}]*$/iu;

function lerLetra(texto) {
  const t = String(texto || '').trim();
  if (!t || t.length > 30) return null;
  const m = t.match(RE_LETRA);
  if (!m) return null;
  const c = m[1].toUpperCase();
  return /[1-4]/.test(c) ? LETRAS[Number(c) - 1] : c;
}

function embaralhar(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function validar(lista) {
  if (!Array.isArray(lista)) throw new Error('perguntas-milhao.json inválido.');
  const ok = lista.filter((q) => q && typeof q.pergunta === 'string' && Array.isArray(q.alternativas)
    && q.alternativas.length === 4 && Number.isInteger(q.correta) && q.correta >= 0 && q.correta < 4);
  if (ok.length < 10) throw new Error('perguntas-milhao.json precisa de pelo menos 10 perguntas válidas.');
  return ok.map((q, i) => ({
    id: q.id || `m${i + 1}`,
    nivel: [1, 2, 3].includes(q.nivel) ? q.nivel : 2,
    categoria: q.categoria === 'financas' ? 'financas' : 'trabalhista',
    pergunta: q.pergunta.slice(0, 140),
    alternativas: q.alternativas.map((a) => String(a).slice(0, 48)),
    correta: q.correta,
    explicacao: String(q.explicacao || '').slice(0, 140),
  }));
}

function criarMilhao({ broadcast, getCfg, perguntas }) {
  let banco = validar(perguntas);
  const usadas = new Set(); // evita repetir pergunta entre rodadas até esgotar o nível

  const c = () => {
    const m = getCfg().milhao || {};
    return {
      pergunta: Math.max(8, Number(m.segundosPergunta) || 15),
      revelacao: Math.max(3, Number(m.segundosRevelacao) || 6),
      fimRodada: Math.max(5, Number(m.segundosFimRodada) || 12),
      entradaAte: Math.max(1, Math.min(10, Number(m.entradaAtePergunta) || 3)),
      maxVidas: Math.max(1, Number(m.maxVidas) || 3),
      rodape: String(m.rodape || 'Prêmio simbólico em pontos. Conteúdo educativo.'),
    };
  };

  const st = {
    fase: 'pergunta', // pergunta | revelacao | fim
    rodada: 0,
    degrau: 0, // 0..9
    atual: null, // pergunta com alternativas na ordem exibida
    fimEm: 0,
    contagem: [0, 0, 0, 0],
    respostas: new Map(), // userId -> { letra, nick, avatar }
    jogadores: new Map(), // userId -> { nick, avatar, vivo, vidas, chegou }
    eliminadosAgora: [],
    salvosAgora: [],
    ganhadores: [],
    maisLonge: null,
    hall: new Map(), // userId -> { nick, avatar, melhor (índice do degrau), vitorias }
  };

  function sortearPergunta(nivel) {
    let candidatas = banco.filter((q) => q.nivel === nivel && !usadas.has(q.id));
    if (!candidatas.length) { banco.filter((q) => q.nivel === nivel).forEach((q) => usadas.delete(q.id)); candidatas = banco.filter((q) => q.nivel === nivel); }
    if (!candidatas.length) candidatas = banco; // banco sem esse nível: usa qualquer uma
    const q = candidatas[Math.floor(Math.random() * candidatas.length)];
    usadas.add(q.id);
    // embaralha as alternativas mantendo a correta
    const ordem = embaralhar([0, 1, 2, 3]);
    return { ...q, alternativas: ordem.map((i) => q.alternativas[i]), correta: ordem.indexOf(q.correta) };
  }

  const vivos = () => [...st.jogadores.values()].filter((j) => j.vivo);
  const pub = (j) => ({ nick: j.nick, avatar: j.avatar });

  function topHall(n = 5) {
    return [...st.hall.values()]
      .sort((a, b) => b.vitorias - a.vitorias || b.melhor - a.melhor)
      .slice(0, n)
      .map((h) => ({ nick: h.nick, avatar: h.avatar, melhor: ESCADA[h.melhor]?.rot || '', vitorias: h.vitorias }));
  }

  function snapshot() {
    const q = st.atual, cf = c();
    const v = vivos();
    return {
      type: 'milhao',
      fase: st.fase,
      rodada: st.rodada,
      degrau: st.degrau,
      escada: ESCADA.map((e) => e.rot),
      pergunta: q && {
        id: q.id, categoria: q.categoria, pergunta: q.pergunta, alternativas: q.alternativas,
        correta: st.fase === 'pergunta' ? null : q.correta, // só revela depois do tempo
        explicacao: st.fase === 'pergunta' ? null : q.explicacao,
      },
      fimEm: st.fimEm,
      contagem: st.contagem,
      totalRespostas: st.respostas.size,
      vivos: v.length,
      vivosAmostra: v.slice(0, 12).map(pub),
      eliminados: [...st.jogadores.values()].filter((j) => !j.vivo).length,
      entradaAberta: st.degrau < cf.entradaAte,
      eliminadosAgora: st.eliminadosAgora.slice(0, 12),
      salvosAgora: st.salvosAgora.slice(0, 6),
      ganhadores: st.ganhadores.slice(0, 8),
      maisLonge: st.maisLonge,
      hall: topHall(5),
      rodape: cf.rodape,
      duracao: { pergunta: cf.pergunta, revelacao: cf.revelacao, fim: cf.fimRodada },
      musica: getCfg().musica || { habilitada: true, volume: 0.35 },
      agora: Date.now(),
    };
  }

  function novaRodada() {
    st.rodada++;
    st.degrau = 0;
    st.jogadores = new Map();
    st.ganhadores = [];
    st.maisLonge = null;
    perguntar();
  }

  function perguntar() {
    st.atual = sortearPergunta(NIVEL_DO_DEGRAU[st.degrau]);
    st.fase = 'pergunta';
    st.fimEm = Date.now() + c().pergunta * 1000;
    st.contagem = [0, 0, 0, 0];
    st.respostas = new Map();
    st.eliminadosAgora = [];
    st.salvosAgora = [];
    broadcast(snapshot());
  }

  function registrarHall(id, j, venceu) {
    const h = st.hall.get(id) || { nick: j.nick, avatar: j.avatar, melhor: -1, vitorias: 0 };
    h.nick = j.nick; h.avatar = j.avatar || h.avatar;
    h.melhor = Math.max(h.melhor, j.chegou);
    if (venceu) h.vitorias++;
    st.hall.set(id, h);
  }

  function revelar() {
    const q = st.atual;
    const certa = LETRAS[q.correta];
    for (const [id, r] of st.respostas) {
      const j = st.jogadores.get(id);
      if (!j || !j.vivo) continue; // plateia: só conta no gráfico
      if (r.letra === certa) {
        j.chegou = st.degrau;
        registrarHall(id, j, false);
      } else if (j.vidas > 0) {
        j.vidas--;
        st.salvosAgora.push(pub(j));
      } else {
        j.vivo = false;
        st.eliminadosAgora.push(pub(j));
      }
    }
    st.fase = 'revelacao';
    st.fimEm = Date.now() + c().revelacao * 1000;

    const ultima = st.degrau === ESCADA.length - 1;
    const fechouEntrada = st.degrau + 1 >= c().entradaAte;
    if (ultima) {
      for (const [id, j] of st.jogadores) {
        const r = st.respostas.get(id);
        if (j.vivo && r && r.letra === certa) { st.ganhadores.push(pub(j)); registrarHall(id, j, true); }
      }
    }
    broadcast(snapshot());
    // decide o que vem depois da revelação
    st.proximo = ultima || (fechouEntrada && st.jogadores.size > 0 && vivos().length === 0) ? 'fim' : 'pergunta';
  }

  function encerrarRodada() {
    let melhor = null;
    for (const j of st.jogadores.values()) if (j.chegou >= 0 && (!melhor || j.chegou > melhor.chegou)) melhor = j;
    st.maisLonge = melhor ? { ...pub(melhor), premio: ESCADA[melhor.chegou].rot } : null;
    st.fase = 'fim';
    st.fimEm = Date.now() + c().fimRodada * 1000;
    broadcast(snapshot());
  }

  const timer = setInterval(() => {
    if (Date.now() < st.fimEm) return;
    if (st.fase === 'pergunta') revelar();
    else if (st.fase === 'revelacao') {
      if (st.proximo === 'fim') encerrarRodada();
      else { st.degrau++; perguntar(); }
    } else novaRodada();
  }, 250);

  function comentario(user, texto) {
    if (st.fase !== 'pergunta') return false;
    const letra = lerLetra(texto);
    if (!letra || st.respostas.has(user.id)) return false;
    let j = st.jogadores.get(user.id);
    if (!j && st.degrau < c().entradaAte) {
      j = { nick: user.nick, avatar: user.avatar, vivo: true, vidas: 0, chegou: -1 };
      st.jogadores.set(user.id, j);
    }
    const jogando = !!(j && j.vivo);
    st.respostas.set(user.id, { letra, nick: user.nick, avatar: user.avatar });
    st.contagem[LETRAS.indexOf(letra)]++;
    broadcast({ type: 'resposta', user, letra, jogando, contagem: st.contagem, total: st.respostas.size, vivos: vivos().length });
    return true;
  }

  function presente(user, nome) {
    const cf = c();
    let j = st.jogadores.get(user.id);
    let acao;
    if (!j) {
      // presente de quem ainda não entrou: entra no jogo com uma vida (se a rodada não acabou)
      if (st.fase === 'fim') return;
      j = { nick: user.nick, avatar: user.avatar, vivo: true, vidas: 1, chegou: st.degrau - 1 };
      st.jogadores.set(user.id, j);
      acao = 'entrou';
    } else if (!j.vivo) {
      if (st.fase === 'fim' || st.degrau >= ESCADA.length - 1) return; // não ressuscita na última
      j.vivo = true;
      acao = 'voltou';
    } else {
      if (j.vidas >= cf.maxVidas) return broadcast({ type: 'vida', user, presente: nome, acao: 'max', vidas: j.vidas });
      j.vidas++;
      acao = 'vida';
    }
    broadcast({ type: 'vida', user, presente: nome, acao, vidas: j.vidas });
    broadcast(snapshot());
  }

  function pular() {
    if (st.fase === 'pergunta') revelar();
    else st.fimEm = 0; // avança a próxima transição
  }

  function reiniciar() { st.hall.clear(); st.rodada = 0; novaRodada(); }
  function recarregarPerguntas(lista) { banco = validar(lista); usadas.clear(); }

  novaRodada();
  return { comentario, presente, snapshot, reiniciar, pular, recarregarPerguntas, parar: () => clearInterval(timer), total: () => banco.length };
}

module.exports = { criarMilhao, lerLetra, ESCADA };
