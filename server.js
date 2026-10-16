'use strict';
/**
 * Urna Live — ponte TikTok LIVE -> jogo no navegador (OBS Browser Source).
 *
 * Uso:
 *   node server.js            conecta na live do @ definido em config.json
 *   node server.js --sim      modo simulado (eventos falsos, sem TikTok)
 *   node server.js --user=fulano   sobrescreve o @ do config
 *
 * Abre:  http://127.0.0.1:3000/        (jogo  -> Browser Source 1080x1920)
 *        http://127.0.0.1:3000/admin   (painel: zerar, votos manuais, status)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const STATE_FILE = path.join(ROOT, 'state.json');
const PORT = Number(process.env.PORT) || 3000;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);

// --lan: libera acesso pela rede Wi-Fi (celular), exigindo chave na URL
// Na nuvem (Render etc.) defina a variável CHAVE: o servidor abre para a internet e exige ?k=CHAVE
const NUVEM = !!process.env.CHAVE;
const LAN = !!args.lan || NUVEM;
const HOST = LAN ? '0.0.0.0' : '127.0.0.1';
const CHAVE = LAN ? String(process.env.CHAVE || args.chave || crypto.randomBytes(4).toString('hex')) : null;
if (NUVEM && CHAVE.length < 8) throw new Error('CHAVE muito curta: use pelo menos 8 caracteres.');

// ---------------------------------------------------------------- config
// imagens só de dentro de public/img (sem URL externa nem caminho arbitrário)
const IMG_RE = /^img\/[\w.-]+\.(png|jpe?g|webp|gif)$/i;
function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  if (!Array.isArray(cfg.opcoes) || cfg.opcoes.length !== 2) {
    throw new Error('config.json: "opcoes" precisa ter exatamente 2 itens.');
  }
  for (const o of cfg.opcoes) {
    if (!/^\d{1,5}$/.test(String(o.numero))) throw new Error(`Número inválido: ${o.numero}`);
    o.numero = String(o.numero);
    // imagem só de dentro de public/img (evita caminho arbitrário ou URL externa)
    if (o.imagem && !IMG_RE.test(o.imagem)) {
      console.warn(`[config] imagem ignorada (use img/arquivo.png): ${o.imagem}`);
      o.imagem = '';
    }
  }
  if (cfg.opcoes[0].numero === cfg.opcoes[1].numero) throw new Error('Os dois números são iguais.');
  cfg.presentes = cfg.presentes || {};
  for (const [nome, g] of Object.entries(cfg.presentes)) {
    if (g.iconeImagem && !IMG_RE.test(g.iconeImagem)) {
      console.warn(`[config] iconeImagem ignorada em ${nome}: ${g.iconeImagem}`);
      g.iconeImagem = '';
    }
  }
  if (cfg.fundo && !IMG_RE.test(cfg.fundo)) { console.warn(`[config] fundo ignorado: ${cfg.fundo}`); cfg.fundo = ''; }
  return cfg;
}
let cfg = loadConfig();
const numeros = () => cfg.opcoes.map((o) => o.numero);

// ---------------------------------------------------------------- estado
function freshState() {
  return {
    votos: Object.fromEntries(numeros().map((n) => [n, 0])),
    doadores: {}, // uniqueId -> { nick, avatar, votos, numero }
    rodadaFimEm: Date.now() + cfg.rodada.duracaoSegundos * 1000,
    vencedor: null,
    rodada: 1,
  };
}
let state = freshState();
try {
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (saved && saved.votos && numeros().every((n) => n in saved.votos)) {
    state = { ...state, ...saved, rodadaFimEm: Date.now() + cfg.rodada.duracaoSegundos * 1000, vencedor: null };
    console.log('[estado] placar anterior restaurado de state.json');
  }
} catch { /* sem estado salvo */ }

let dirty = false;
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  fs.writeFile(STATE_FILE, JSON.stringify(state), () => {});
}, 3000);

// memória por usuário (não persiste)
const ultimoNumero = new Map(); // uniqueId -> numero escolhido no chat
const ultimoVotoComentario = new Map(); // uniqueId -> timestamp
const pendentes = new Map(); // uniqueId -> { votos, presente, expira } (presente sem time)
const combos = new Map(); // numero -> { count, ate }
const curtidasAcum = new Map(); // uniqueId -> curtidas ainda não convertidas em voto

// diagnóstico: o que chegou da live no último minuto
const stats = { chat: 0, curtidas: 0, entradas: 0, presentes: 0, votos: 0 };
let chatsLogados = 0;
setInterval(() => {
  if (!/^conectado/.test(conexaoStatus)) return;
  console.log(`[stats/min] comentarios=${stats.chat} curtidas=${stats.curtidas} entradas=${stats.entradas} presentes=${stats.presentes} votos=${stats.votos}`);
  for (const k in stats) stats[k] = 0;
}, 60000);

// ---------------------------------------------------------------- broadcast
const clients = new Set();
function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === 1) ws.send(data);
}
function snapshot() {
  const top = Object.entries(state.doadores)
    .map(([id, d]) => ({ id, ...d }))
    .sort((a, b) => b.votos - a.votos)
    .slice(0, 5);
  return {
    type: 'state',
    config: {
      opcoes: cfg.opcoes,
      presentes: cfg.presentes,
      multiplicadorFinal: cfg.multiplicadorFinal || null,
      fundo: cfg.fundo || '',
      mostrarTotalDeVotos: cfg.mostrarTotalDeVotos !== false,
      musica: cfg.musica || { habilitada: true, volume: 0.35 },
    },
    votos: state.votos,
    top,
    rodadaFimEm: state.rodadaFimEm,
    vencedor: state.vencedor,
    rodada: state.rodada,
    conexao: conexaoStatus,
    agora: Date.now(),
  };
}

// ---------------------------------------------------------------- regras
function sanitizeUser(u = {}) {
  const id = String(u.uniqueId || u.id || 'anon').slice(0, 40);
  const nick = String(u.nickname || id).slice(0, 32);
  let avatar = u.avatar || u.profilePicture?.url?.[0] || u.profilePictureUrl || '';
  if (typeof avatar !== 'string' || !/^https:\/\//.test(avatar)) avatar = '';
  return { id, nick, avatar };
}

function multiplicadorAtual() {
  const m = cfg.multiplicadorFinal;
  if (!m || !m.fator || m.fator <= 1 || !cfg.rodada.duracaoSegundos) return 1;
  return state.rodadaFimEm - Date.now() <= m.segundos * 1000 ? m.fator : 1;
}

function registrarVoto(user, numero, votos, origem, presente) {
  if (state.vencedor) return; // tela de vencedor: ignora até reiniciar
  if (!numeros().includes(numero) || !(votos > 0)) return;

  const mult = multiplicadorAtual();
  votos = Math.round(votos * mult);
  state.votos[numero] += votos;
  stats.votos += votos;
  dirty = true;

  const d = (state.doadores[user.id] ||= { nick: user.nick, avatar: user.avatar, votos: 0, numero });
  d.nick = user.nick;
  d.avatar = user.avatar || d.avatar;
  d.numero = numero;
  if (origem === 'presente') d.votos += votos;
  if (origem !== 'presente' && !d.votos) delete state.doadores[user.id]; // ranking só de presente

  const now = Date.now();
  const c = combos.get(numero);
  const combo = c && c.ate > now ? c.count + 1 : 1;
  combos.set(numero, { count: combo, ate: now + cfg.comboJanelaSegundos * 1000 });

  broadcast({ type: 'voto', numero, votos, origem, presente: presente || null, user, combo, mult });
  broadcast(snapshot());
}

function onComentario(rawUser, texto) {
  const user = sanitizeUser(rawUser);
  stats.chat++;
  if (chatsLogados < 40) { chatsLogados++; console.log(`[chat] @${user.id}: ${String(texto || '').slice(0, 80)}`); }
  const m = String(texto || '').match(/\b(\d{1,5})\b/);
  if (!m || !numeros().includes(m[1])) return;
  const numero = m[1];
  ultimoNumero.set(user.id, numero);

  // presente que estava esperando o usuário escolher o time
  const p = pendentes.get(user.id);
  if (p && p.expira > Date.now()) {
    pendentes.delete(user.id);
    registrarVoto(user, numero, p.votos, 'presente', p.presente);
  }

  if (!cfg.comentario.habilitado) return;
  const last = ultimoVotoComentario.get(user.id) || 0;
  if (Date.now() - last < cfg.comentario.cooldownSegundos * 1000) return; // anti-spam
  ultimoVotoComentario.set(user.id, Date.now());
  registrarVoto(user, numero, cfg.comentario.votos, 'comentario');
}

function onPresente(rawUser, { nome, repeticoes, diamantes }) {
  stats.presentes++;
  const user = sanitizeUser(rawUser);
  const regra = cfg.presentes[nome];
  const unit = regra ? regra.votos : (diamantes || 0) * (cfg.votosPorDiamanteParaPresentesNaoMapeados || 0);
  const votos = Math.round(unit * Math.max(1, repeticoes || 1));
  if (!(votos > 0)) return;

  const numero = (regra && regra.numero && String(regra.numero)) || ultimoNumero.get(user.id);
  if (numero) return registrarVoto(user, numero, votos, 'presente', nome);

  // não sabe o time: guarda 2 min esperando a pessoa digitar o número
  const prev = pendentes.get(user.id);
  pendentes.set(user.id, {
    votos: (prev && prev.expira > Date.now() ? prev.votos : 0) + votos,
    presente: nome,
    expira: Date.now() + 120000,
  });
  broadcast({ type: 'pendente', user, presente: nome, votos, numeros: numeros() });
}

function onCurtida(rawUser, qtd) {
  const c = cfg.curtidas || {};
  const n = Math.max(1, Number(qtd) || 1);
  stats.curtidas += n;
  if (c.habilitado === false) return;
  const user = sanitizeUser(rawUser);
  const numero = ultimoNumero.get(user.id);
  if (!numero) return; // curtida só vale para quem já escolheu o time no chat
  const por = Math.max(1, Number(c.curtidasPorVoto) || 5);
  const total = (curtidasAcum.get(user.id) || 0) + n;
  const votos = Math.floor(total / por);
  curtidasAcum.set(user.id, total % por);
  if (votos > 0) registrarVoto(user, numero, votos, 'curtida');
}

let ultimaEntrada = 0;
function onEntrada(rawUser) {
  stats.entradas++;
  const now = Date.now();
  if (now - ultimaEntrada < 4000) return; // no máximo um aviso a cada 4 s
  ultimaEntrada = now;
  broadcast({ type: 'entrou', user: sanitizeUser(rawUser), numeros: numeros() });
}

function reiniciar() {
  state = { ...freshState(), rodada: (state.rodada || 0) + 1 };
  combos.clear();
  pendentes.clear();
  dirty = true;
  broadcast({ type: 'reset' });
  broadcast(snapshot());
}

// relógio da rodada
setInterval(() => {
  if (!cfg.rodada.duracaoSegundos) return;
  const now = Date.now();
  if (!state.vencedor && now >= state.rodadaFimEm) {
    const [a, b] = numeros();
    const va = state.votos[a], vb = state.votos[b];
    state.vencedor = va === vb ? 'empate' : va > vb ? a : b;
    state.vencedorAte = now + cfg.rodada.exibirVencedorSegundos * 1000;
    dirty = true;
    broadcast({ type: 'fim', vencedor: state.vencedor });
    broadcast(snapshot());
  } else if (state.vencedor && cfg.rodada.reiniciarAutomaticamente && now >= state.vencedorAte) {
    reiniciar();
  }
}, 500);

// ---------------------------------------------------------------- fonte de eventos
let conexaoStatus = 'desconectado';
function setStatus(s) {
  conexaoStatus = s;
  console.log('[tiktok]', s);
  broadcast({ type: 'status', conexao: s });
}

function startSimulador() {
  setStatus('simulado');
  const nomes = ['joaozinho', 'mari_s2', 'zeca.br', 'lu_gamer', 'pedrin77', 'ana.clara', 'tio_ze', 'bia_fofa', 'kaique', 'nanda'];
  const gifts = Object.keys(cfg.presentes);
  setInterval(() => {
    const u = nomes[Math.floor(Math.random() * nomes.length)];
    const user = { uniqueId: u, nickname: u };
    const r = Math.random();
    if (r < 0.12) onEntrada(user);
    else if (r < 0.3) onCurtida(user, 1 + Math.floor(Math.random() * 6));
    else if (r < 0.8) {
      const n = numeros()[Math.random() < 0.55 ? 0 : 1];
      onComentario(user, Math.random() < 0.5 ? n : `vai ${n}!!`);
    } else if (gifts.length) {
      onPresente(user, { nome: gifts[Math.floor(Math.random() * gifts.length)], repeticoes: 1 + Math.floor(Math.random() * 3) });
    }
  }, 700);
}

async function startTikTok(username) {
  const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('tiktok-live-connector');
  let tentativa = 0;
  const conectar = async () => {
    // enableExtendedGiftInfo baixa o catálogo de presentes por um endpoint que exige plano pago
    // do Euler Stream e derruba a conexão inteira. O nome do presente já vem em cada evento.
    const conn = new TikTokLiveConnection(username, { enableExtendedGiftInfo: false });

    conn.on(WebcastEvent.CHAT, (d) => onComentario(d.user, d.comment));
    conn.on(WebcastEvent.LIKE, (d) => onCurtida(d.user, d.likeCount));
    conn.on(WebcastEvent.MEMBER, (d) => onEntrada(d.user));
    conn.on(WebcastEvent.GIFT, (d) => {
      const tipo = d.giftDetails?.giftType;
      if (tipo === 1 && !d.repeatEnd) return; // sequência em andamento: conta só no fim
      console.log(`[presente] ${d.user?.uniqueId} -> "${d.giftDetails?.giftName}" x${d.repeatCount || 1} (${d.giftDetails?.diamondCount || 0} diamantes)`);
      onPresente(d.user, {
        nome: d.giftDetails?.giftName || String(d.giftId),
        repeticoes: d.repeatCount || 1,
        diamantes: d.giftDetails?.diamondCount || 0,
      });
    });
    conn.on(WebcastEvent.STREAM_END, () => { setStatus('live encerrada'); agendar(); });
    conn.on(ControlEvent.DISCONNECTED, () => { setStatus('desconectado'); agendar(); });
    conn.on(ControlEvent.ERROR, (e) => console.error('[tiktok] erro:', e?.message || e));

    try {
      setStatus(`conectando em @${username}…`);
      await conn.connect();
      tentativa = 0;
      chatsLogados = 0;
      setStatus(`conectado @${username}`);
    } catch (e) {
      console.error('[tiktok] falha ao conectar:', e?.message || e);
      setStatus('offline (tentando de novo)');
      agendar();
    }
  };
  let timer = null;
  const agendar = () => {
    if (timer) return;
    const espera = Math.min(60, 5 * 2 ** tentativa++) * 1000;
    timer = setTimeout(() => { timer = null; conectar(); }, espera);
  };
  conectar();
}

// ---------------------------------------------------------------- http + ws
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/ping') { res.writeHead(204); return res.end(); } // mantém o serviço acordado
  let p = url.pathname === '/' ? '/index.html' : url.pathname === '/admin' ? '/admin.html' : url.pathname;
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  // aceita só páginas servidas por este servidor (mesmo host)
  const origin = req.headers.origin || '';
  if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return ws.close();
  if (LAN) {
    const k = new URL(req.url, 'http://x').searchParams.get('k') || '';
    const a = Buffer.from(k), b = Buffer.from(CHAVE);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return ws.close(4001, 'chave');
  }
  clients.add(ws);
  ws.send(JSON.stringify(snapshot()));
  ws.on('close', () => clients.delete(ws));
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.cmd === 'reset') reiniciar();
    else if (m.cmd === 'manual' && numeros().includes(String(m.numero))) {
      registrarVoto({ id: 'admin', nick: 'Manual', avatar: '' }, String(m.numero), Math.max(1, Math.min(1000, Number(m.votos) || 1)), 'comentario');
    } else if (m.cmd === 'reload-config') {
      try { cfg = loadConfig(); broadcast(snapshot()); console.log('[config] recarregado'); }
      catch (e) { console.error('[config]', e.message); }
    }
  });
});

function ipsLocais() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

server.listen(PORT, HOST, () => {
  if (NUVEM) {
    console.log(`\n  MODO NUVEM: abra https://SEU-SERVICO.onrender.com/?k=<CHAVE>  (painel: /admin?k=<CHAVE>)\n`);
  } else if (LAN) {
    const ips = ipsLocais();
    console.log('\n  MODO REDE (celular no mesmo Wi-Fi). Abra no celular:');
    for (const ip of ips) console.log(`    Jogo:   http://${ip}:${PORT}/?k=${CHAVE}\n    Painel: http://${ip}:${PORT}/admin?k=${CHAVE}`);
    console.log('\n  Não divulgue esse link: quem tiver a chave consegue zerar o placar.\n');
  } else {
    console.log(`\n  Jogo:   http://127.0.0.1:${PORT}/\n  Painel: http://127.0.0.1:${PORT}/admin\n`);
  }
  const user = args.user || process.env.TIKTOK_USER || cfg.tiktokUsername;
  if (args.sim) startSimulador();
  else if (!user || user === 'seu_usuario_aqui') {
    console.log('  Defina "tiktokUsername" no config.json ou rode com --sim.\n');
    setStatus('sem usuário configurado');
  } else startTikTok(String(user).replace(/^@/, ''));
});
