/* Som do jogo: música estilo videogame sintetizada (original, sem direitos autorais) + efeitos.
 * Uso: Som.configurar({habilitada, volume}); Som.tom(freq, dur, quando, vol); Som.abaixar();
 * No iPhone o áudio só libera no fim de um toque: o aviso #som some quando destrava. */
(() => {
  'use strict';
  let ac = null, musica = null, musicVol = 0.35, musicOn = true, mudo = null, estilo = 'arcade', urgente = false;
  const ehCelular = /Android|iPhone|iPad/i.test(navigator.userAgent);
  const aviso = () => document.getElementById('som');

  const audio = () => {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  };

  function tom(freq, dur, quando = 0, vol = 0.12, tipo = 'square') {
    const a = audio(); if (!a || a.state !== 'running') return;
    const t = a.currentTime + quando, o = a.createOscillator(), g = a.createGain();
    o.type = tipo; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }

  function iniciarMusica() {
    if (estilo === 'suspense') return iniciarSuspense();
    const a = audio(); if (!a || musica || !musicOn || a.state !== 'running') return;
    const master = a.createGain(); master.gain.value = musicVol * 0.5; master.connect(a.destination);
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const bpm = 128, step = 60 / bpm / 4;
    const acordes = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
    const baixos = [45, 41, 36, 43];
    const arpejo = [0, 1, 2, 1, 2, 0, 1, 2];
    const melodia = [76, -1, 74, 72, -1, 72, 74, -1, 76, -1, 79, -1, 77, 76, 74, -1,
                     72, -1, 74, 76, -1, 76, 74, -1, 72, -1, 69, -1, 71, -1, 72, -1];
    const ruido = a.createBuffer(1, a.sampleRate * 0.2, a.sampleRate);
    const ch = ruido.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    const nota = (tipo, f, t, d, v) => {
      const o = a.createOscillator(), g = a.createGain(); o.type = tipo; o.frequency.value = f;
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(master); o.start(t); o.stop(t + d + 0.02);
    };
    const bumbo = (t) => {
      const o = a.createOscillator(), g = a.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.18);
    };
    const chiado = (t, v, d, freq, filtro) => {
      const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      src.buffer = ruido; f.type = filtro; f.frequency.value = freq;
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      src.connect(f).connect(g).connect(master); src.start(t); src.stop(t + d + 0.02);
    };
    let prox = a.currentTime + 0.1, i = 0;
    const timer = setInterval(() => {
      while (prox < a.currentTime + 0.15) {
        const comp = Math.floor(i / 16) % 4, s = i % 16, ac2 = acordes[comp];
        if (s % 4 === 0) bumbo(prox);
        if (s % 8 === 4) chiado(prox, 0.35, 0.14, 1800, 'bandpass');
        if (s % 2 === 0) chiado(prox, s % 4 === 2 ? 0.1 : 0.05, 0.04, 7000, 'highpass');
        if (s % 2 === 0) nota('triangle', mtof(baixos[comp] + (s % 8 === 6 ? 12 : 0)), prox, step * 1.8, 0.32);
        nota('square', mtof(ac2[arpejo[(s >> 1) % 8]] + 12), prox, step * 0.8, 0.035);
        const m = melodia[Math.floor(i / 2) % melodia.length];
        if (s % 2 === 0 && m > 0 && Math.floor(i / 64) % 2 === 1) nota('square', mtof(m), prox, step * 1.7, 0.05);
        prox += step; i++;
      }
    }, 25);
    musica = { master, timer };
  }


  // ---- trilha original de suspense para game show (composição própria)
  function ruidoBuf(a) {
    const b = a.createBuffer(1, a.sampleRate * 0.5, a.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function iniciarSuspense() {
    const a = audio(); if (!a || musica || !musicOn || a.state !== 'running') return;
    const master = a.createGain(); master.gain.value = musicVol * 0.55; master.connect(a.destination);
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const ruido = ruidoBuf(a);
    // pad: dois osciladores dente-de-serra levemente desafinados num filtro passa-baixa
    const padFiltro = a.createBiquadFilter(); padFiltro.type = 'lowpass'; padFiltro.frequency.value = 700; padFiltro.Q.value = 6;
    const padGain = a.createGain(); padGain.gain.value = 0.05; padFiltro.connect(padGain).connect(master);
    const padOsc = [0, 1, 2].map(() => [a.createOscillator(), a.createOscillator()]);
    padOsc.forEach((par) => par.forEach((o, k) => { o.type = 'sawtooth'; o.detune.value = k ? 9 : -9; o.connect(padFiltro); o.start(); }));
    const acordes = [[52, 55, 59], [48, 52, 55], [45, 48, 52], [47, 51, 54]]; // Em C Am B
    const baixo = [40, 40, 43, 40, 41, 40, 38, 40];
    const kick = (t, v = 0.8) => {
      const o = a.createOscillator(), g = a.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.25);
    };
    const tic = (t, v, f) => {
      const src = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain();
      src.buffer = ruido; fl.type = 'highpass'; fl.frequency.value = f;
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      src.connect(fl).connect(g).connect(master); src.start(t); src.stop(t + 0.05);
    };
    const nota = (f, t, d, v, tipo = 'triangle') => {
      const o = a.createOscillator(), g = a.createGain(); o.type = tipo; o.frequency.value = f;
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(master); o.start(t); o.stop(t + d + 0.02);
    };
    let prox = a.currentTime + 0.1, i = 0;
    const timer = setInterval(() => {
      const bpm = urgente ? 150 : 108, step = 60 / bpm / 4;
      while (prox < a.currentTime + 0.15) {
        const comp = Math.floor(i / 16) % 4, s = i % 16;
        if (s === 0) { // troca o acorde do pad a cada compasso
          acordes[comp].forEach((n, k) => padOsc[k].forEach((o) => o.frequency.setTargetAtTime(mtof(n), prox, 0.08)));
          padFiltro.frequency.setTargetAtTime(urgente ? 1800 : 650 + comp * 120, prox, 0.4);
        }
        if (s === 0 || s === 3) kick(prox, s === 0 ? 0.85 : 0.45); // batida de coração
        if (s % 4 === 0) tic(prox, urgente ? 0.16 : 0.09, 6000); // relógio
        if (urgente && s % 2 === 1) tic(prox, 0.07, 8000);
        if (s % 2 === 0) nota(mtof(baixo[(i >> 1) % 8]), prox, step * 1.6, 0.28);
        if (urgente && s % 4 === 2) nota(mtof(76 + (comp % 2)), prox, step, 0.04, 'square');
        prox += step; i++;
      }
    }, 25);
    musica = { master, timer, parar: () => padOsc.flat().forEach((o) => { try { o.stop(); } catch {} }) };
  }

  // efeitos de impacto
  function stinger(tipo) {
    const a = audio(); if (!a || a.state !== 'running') return;
    const t = a.currentTime;
    if (tipo === 'revela') { // subida de tensão + pancada
      const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      src.buffer = ruidoBuf(a); f.type = 'bandpass'; f.Q.value = 3;
      f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(5000, t + 0.45);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      src.connect(f).connect(g).connect(a.destination); src.start(t); src.stop(t + 0.55);
      tom(55, 0.5, 0.45, 0.5, 'sine'); tom(110, 0.35, 0.45, 0.2, 'sawtooth');
    } else if (tipo === 'certo') {
      [523, 659, 784, 1047].forEach((f, k) => tom(f, 0.22, k * 0.09, 0.11, 'square'));
    } else if (tipo === 'errado') {
      tom(220, 0.25, 0, 0.14, 'sawtooth'); tom(165, 0.45, 0.22, 0.14, 'sawtooth');
    } else if (tipo === 'milhao') {
      [[523, 0], [659, .12], [784, .24], [1047, .36], [784, .6], [1047, .72]].forEach(([f, d]) => { tom(f, 0.3, d, 0.12, 'square'); tom(f / 2, 0.3, d, 0.08, 'triangle'); });
      tom(1047, 1.2, 0.9, 0.12, 'square'); tom(1319, 1.2, 0.9, 0.09, 'square'); tom(1568, 1.2, 0.9, 0.07, 'square');
    }
  }
  function setUrgente(v) { urgente = !!v; }

  function abaixar(fator = 0.25, volta = 1.3) {
    if (!musica || !musicOn) return;
    const g = musica.master.gain, t = ac.currentTime, alvo = musicVol * (estilo === 'suspense' ? 0.55 : 0.5);
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(alvo * fator, t + 0.05); g.linearRampToValueAtTime(alvo, t + volta);
  }

  function configurar(c) {
    c = c || {};
    musicOn = c.habilitada !== false;
    musicVol = Math.max(0, Math.min(1, Number(c.volume ?? 0.35)));
    if (c.estilo && c.estilo !== estilo) { // trocar de trilha: para a atual e começa a nova
      estilo = c.estilo;
      if (musica) { clearInterval(musica.timer); if (musica.parar) musica.parar(); musica.master.disconnect(); musica = null; }
    }
    if (musica) musica.master.gain.value = musicOn ? musicVol * 0.5 : 0;
    else if (musicOn && ac && ac.state === 'running') iniciarMusica(); // já destravado (troca de trilha)
    else if (musicOn && !ehCelular) { audio(); setTimeout(iniciarMusica, 300); } // PC/OBS/LIVE Studio toca sem toque
  }

  // ---- iPhone: tocar com a chave no silencioso e liberar no fim do toque
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  function audioMudo() {
    if (mudo) return;
    const sr = 8000, n = sr / 2, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, n * 2, true);
    mudo = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
    mudo.loop = true; mudo.setAttribute('playsinline', ''); mudo.play().catch(() => {});
  }
  let wake = null;
  async function manterAcesa() {
    try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch {}
  }
  function destravar() {
    manterAcesa(); audioMudo();
    const a = audio(); if (!a) return;
    try { const b = a.createBuffer(1, 1, 22050), src = a.createBufferSource(); src.buffer = b; src.connect(a.destination); src.start(0); } catch {}
    const ok = () => {
      if (a.state !== 'running') return;
      iniciarMusica();
      if (aviso()) aviso().classList.remove('on');
      ['touchend', 'click'].forEach((ev) => removeEventListener(ev, destravar));
    };
    (a.resume ? a.resume() : Promise.resolve()).then(ok, ok);
  }
  ['touchend', 'click'].forEach((ev) => addEventListener(ev, destravar));
  addEventListener('DOMContentLoaded', () => { if (ehCelular && aviso()) aviso().classList.add('on'); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    manterAcesa();
    if (!ac) return;
    ac.resume().catch(() => {});
    if (mudo) mudo.play().catch(() => {});
    setTimeout(() => {
      if (ac.state !== 'running' && aviso()) {
        aviso().classList.add('on');
        ['touchend', 'click'].forEach((ev) => addEventListener(ev, destravar));
      }
    }, 600);
  });

  window.Som = { tom, configurar, abaixar, iniciar: iniciarMusica, stinger, setUrgente };
})();
