/* Som do jogo: música estilo videogame sintetizada (original, sem direitos autorais) + efeitos.
 * Uso: Som.configurar({habilitada, volume}); Som.tom(freq, dur, quando, vol); Som.abaixar();
 * No iPhone o áudio só libera no fim de um toque: o aviso #som some quando destrava. */
(() => {
  'use strict';
  let ac = null, musica = null, musicVol = 0.35, musicOn = true, mudo = null;
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

  function abaixar(fator = 0.25, volta = 1.3) {
    if (!musica || !musicOn) return;
    const g = musica.master.gain, t = ac.currentTime, alvo = musicVol * 0.5;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(alvo * fator, t + 0.05); g.linearRampToValueAtTime(alvo, t + volta);
  }

  function configurar(c) {
    c = c || {};
    musicOn = c.habilitada !== false;
    musicVol = Math.max(0, Math.min(1, Number(c.volume ?? 0.35)));
    if (musica) musica.master.gain.value = musicOn ? musicVol * 0.5 : 0;
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

  window.Som = { tom, configurar, abaixar, iniciar: iniciarMusica };
})();
