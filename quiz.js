'use strict';
/**
 * Motor do quiz Verdadeiro/Falso para TikTok LIVE.
 *
 * Ciclo: pergunta (N s) -> revelação (N s) -> [a cada X perguntas: ranking (N s)] -> próxima.
 * Comentário "V"/"F" (ou verdadeiro/falso/sim/não) é a resposta; vale só a primeira por pergunta.
 * Acerto = pontos; primeiro a acertar ganha bônus; presente dá pontos em dobro nesta e na próxima pergunta.
 */

const RE_V = /^\s*(v|verdadeiro|verdade|vdd|true|sim|s)(?![\p{L}\p{N}])/iu;
const RE_F = /^\s*(f|falso|false|mentira|n|nao|não)(?![\p{L}\p{N}])/iu;

function lerResposta(texto) {
  const t = String(texto || '').trim();
  if (!t || t.length > 40) return null; // frase longa não é resposta
  if (/^\s*n[aã]o\s+sei(?![\p{L}\p{N}])/iu.test(t)) return null; // "não sei" não é resposta
  if (RE_V.test(t)) return 'V';
  if (RE_F.test(t)) return 'F';
  return null;
}

function embaralhar(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function validarPerguntas(lista) {
  if (!Array.isArray(lista) || !lista.length) throw new Error('perguntas.json vazio ou inválido.');
  return lista
    .filter((q) => q && typeof q.afirmacao === 'string' && typeof q.resposta === 'boolean')
    .map((q, i) => ({
      id: q.id || `q${i + 1}`,
      categoria: q.categoria === 'financas' ? 'financas' : 'trabalhista',
      afirmacao: q.afirmacao.slice(0, 160),
      resposta: q.resposta ? 'V' : 'F',
      explicacao: String(q.explicacao || '').slice(0, 160),
      emoji: String(q.emoji || '').slice(0, 8),
    }));
}

function criarQuiz({ broadcast, getCfg, perguntas }) {
  let banco = validarPerguntas(perguntas);
  let fila = embaralhar(banco);
  const st = {
    fase: 'pergunta', // pergunta | revelacao | ranking
    numero: 0, // contador de perguntas exibidas
    atual: null,
    fimEm: 0,
    votos: { V: 0, F: 0 },
    respostas: new Map(), // userId -> { resp, ordem }
    primeiroAcerto: null,
    acertaram: 0,
    pontos: new Map(), // userId -> { nick, avatar, pontos, acertos }
    dobro: new Map(), // userId -> quantas perguntas ainda valem em dobro
  };

  const c = () => {
    const q = getCfg().quiz || {};
    return {
      pergunta: Math.max(8, Number(q.segundosPergunta) || 20),
      revelacao: Math.max(3, Number(q.segundosRevelacao) || 7),
      ranking: Math.max(3, Number(q.segundosRanking) || 7),
      rankingCada: Math.max(2, Number(q.rankingACadaPerguntas) || 5),
      pontosAcerto: Number(q.pontosAcerto) || 10,
      bonusPrimeiro: Number(q.bonusPrimeiro) || 5,
      rodape: String(q.rodape || 'Conteúdo educativo. Não substitui orientação profissional.'),
      titulo: String(q.titulo || 'VERDADEIRO OU FALSO?'),
    };
  };

  function top(n = 5) {
    return [...st.pontos.entries()]
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => b.pontos - a.pontos || b.acertos - a.acertos)
      .slice(0, n);
  }

  function snapshot() {
    const q = st.atual;
    const cf = c();
    return {
      type: 'quiz',
      fase: st.fase,
      numero: st.numero,
      pergunta: q && {
        id: q.id, categoria: q.categoria, afirmacao: q.afirmacao, emoji: q.emoji,
        // a resposta só vai para a tela depois que o tempo acaba
        resposta: st.fase === 'pergunta' ? null : q.resposta,
        explicacao: st.fase === 'pergunta' ? null : q.explicacao,
      },
      fimEm: st.fimEm,
      votos: st.votos,
      totalRespostas: st.respostas.size,
      acertaram: st.acertaram,
      primeiroAcerto: st.primeiroAcerto,
      top: top(5),
      titulo: cf.titulo,
      rodape: cf.rodape,
      duracao: { pergunta: cf.pergunta, revelacao: cf.revelacao, ranking: cf.ranking },
      musica: getCfg().musica || { habilitada: true, volume: 0.35 },
      agora: Date.now(),
    };
  }

  function proximaPergunta() {
    if (!fila.length) fila = embaralhar(banco);
    st.atual = fila.shift();
    st.numero++;
    st.fase = 'pergunta';
    st.fimEm = Date.now() + c().pergunta * 1000;
    st.votos = { V: 0, F: 0 };
    st.respostas = new Map();
    st.primeiroAcerto = null;
    st.acertaram = 0;
    broadcast(snapshot());
  }

  function revelar() {
    const q = st.atual;
    const cf = c();
    let ordemAcerto = 0;
    const ordenadas = [...st.respostas.entries()].sort((a, b) => a[1].ordem - b[1].ordem);
    for (const [id, r] of ordenadas) {
      if (r.resp !== q.resposta) continue;
      ordemAcerto++;
      const p = st.pontos.get(id) || { nick: r.nick, avatar: r.avatar, pontos: 0, acertos: 0 };
      let ganho = cf.pontosAcerto + (ordemAcerto === 1 ? cf.bonusPrimeiro : 0);
      if (r.dobro) ganho *= 2;
      p.pontos += ganho;
      p.acertos++;
      p.nick = r.nick; p.avatar = r.avatar || p.avatar;
      st.pontos.set(id, p);
      if (ordemAcerto === 1) st.primeiroAcerto = { nick: r.nick, avatar: r.avatar };
    }
    st.acertaram = ordemAcerto;
    // consome uma pergunta do "em dobro" de quem tinha
    for (const [id, n] of st.dobro) { if (n <= 1) st.dobro.delete(id); else st.dobro.set(id, n - 1); }
    st.fase = 'revelacao';
    st.fimEm = Date.now() + cf.revelacao * 1000;
    broadcast(snapshot());
  }

  function mostrarRanking() {
    st.fase = 'ranking';
    st.fimEm = Date.now() + c().ranking * 1000;
    broadcast(snapshot());
  }

  // relógio
  const timer = setInterval(() => {
    if (Date.now() < st.fimEm) return;
    if (st.fase === 'pergunta') revelar();
    else if (st.fase === 'revelacao') {
      if (st.numero % c().rankingCada === 0 && st.pontos.size) mostrarRanking();
      else proximaPergunta();
    } else proximaPergunta();
  }, 250);

  function comentario(user, texto) {
    if (st.fase !== 'pergunta') return false;
    const resp = lerResposta(texto);
    if (!resp) return false;
    if (st.respostas.has(user.id)) return false; // só a primeira resposta vale
    const dobro = st.dobro.has(user.id);
    st.respostas.set(user.id, { resp, ordem: st.respostas.size, nick: user.nick, avatar: user.avatar, dobro });
    st.votos[resp]++;
    broadcast({ type: 'resposta', user, resp, dobro, votos: st.votos, total: st.respostas.size });
    return true;
  }

  function presente(user, nome) {
    // vale na pergunta atual (se ainda aberta) e na próxima
    const restam = st.fase === 'pergunta' ? 2 : 1;
    st.dobro.set(user.id, Math.max(st.dobro.get(user.id) || 0, restam));
    const r = st.respostas.get(user.id);
    if (r && st.fase === 'pergunta') r.dobro = true;
    broadcast({ type: 'dobro', user, presente: nome });
  }

  function reiniciar() {
    st.pontos.clear();
    st.dobro.clear();
    st.numero = 0;
    fila = embaralhar(banco);
    proximaPergunta();
  }

  function pular() {
    if (st.fase === 'pergunta') revelar();
    else proximaPergunta();
  }

  function recarregarPerguntas(lista) {
    banco = validarPerguntas(lista);
    fila = embaralhar(banco);
  }

  proximaPergunta();
  return { comentario, presente, snapshot, reiniciar, pular, recarregarPerguntas, parar: () => clearInterval(timer), total: () => banco.length };
}

module.exports = { criarQuiz, lerResposta, validarPerguntas };
