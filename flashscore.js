'use strict';
// Lector del feed publico de Flashscore (lista de partidos de tenis) y de la API de cuotas
// (bookmaker 16 = bet365). Solo individuales femeninos: circuito WTA y WTA 125 (Challenger
// mujeres). Excluye clasificacion, dobles e ITF.
const FEED_BASE = 'https://global.flashscore.ninja/2/x/feed/';
const ODDS_URL = 'https://global.ds.lsapp.eu/odds/pq_graphql';
const BET365_ID = 16;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getText(url, headers = {}, intentos = 3) {
  let ult;
  for (let i = 1; i <= intentos; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, ...headers } });
      if (r.ok) return await r.text();
      ult = new Error('HTTP ' + r.status + ' ' + url);
    } catch (e) { ult = e; }
    await sleep(800 * i);
  }
  throw ult;
}

function parseSuperficie(cabecera) {
  const c = cabecera.toLowerCase();
  const interior = /indoor/.test(c);
  let sup = null;
  if (/clay/.test(c)) sup = 'T';
  else if (/grass/.test(c)) sup = 'H';
  else if (/hard/.test(c)) sup = 'D';
  return { sup, interior };
}

// "Wuhan (China), hard" -> "Wuhan"
function ciudad(cabecera) {
  const m = cabecera.match(/:\s*([^()]+?)\s*\(/);
  return m ? m[1].trim() : cabecera;
}

async function listaPartidos(diaOffset) {
  const txt = await getText(`${FEED_BASE}f_2_${diaOffset}_2_en_1`, { 'x-fsign': 'SW9D1eZo' });
  const out = [];
  let cab = null;
  for (const trozo of txt.split('~')) {
    const kv = {};
    for (const par of trozo.split('¬')) {
      const i = par.indexOf('÷');
      if (i > 0) kv[par.slice(0, i)] = par.slice(i + 1);
    }
    if (kv.ZA !== undefined) { cab = kv.ZA; continue; }
    if (kv.AA === undefined || !cab) continue;
    const u = cab.toUpperCase();
    let nivel = null;
    if (u.startsWith('WTA - SINGLES')) nivel = 'WTA';
    else if (u.startsWith('CHALLENGER WOMEN - SINGLES')) nivel = 'W125';
    if (!nivel) continue;
    if (/QUALIFICATION/.test(u)) continue;
    const { sup, interior } = parseSuperficie(cab);
    out.push({
      id: kv.AA,
      ts: Number(kv.AD),
      estado: kv.AB, // 1 programado, 2 en juego, 3 terminado (otros: aplazado/cancelado)
      slugLocal: kv.WU, slugVisit: kv.WV,
      nombreLocalFS: kv.AE, nombreVisitFS: kv.AF,
      cabecera: cab, nivel, sup, interior,
      ciudad: ciudad(cab),
      torneo: 'WTA ' + ciudad(cab),
      dia: diaOffset,
    });
  }
  return out;
}

async function cuotasBet365(eventId) {
  const url = `${ODDS_URL}?_hash=ope2&eventId=${eventId}&bookmakerId=${BET365_ID}&betType=HOME_AWAY&betScope=FULL_TIME`;
  const txt = await getText(url, { origin: 'https://www.flashscore.com', referer: 'https://www.flashscore.com/' });
  let j;
  try { j = JSON.parse(txt); } catch (e) { return null; }
  const o = j && j.data && j.data.findPrematchOddsForBookmaker;
  if (!o || !o.home || !o.away) return null;
  const h = parseFloat(o.home.value), a = parseFloat(o.away.value);
  if (!isFinite(h) || !isFinite(a)) return null;
  return { local: h, visit: a, localApertura: parseFloat(o.home.opening) || null, visitApertura: parseFloat(o.away.opening) || null, activa: !!(o.home.active && o.away.active) };
}

// slug "fernandez-leylah-annie" -> candidatos de nombre ("Leylah Annie Fernandez", "Leylah Fernandez"...)
// Flashscore pone el apellido primero; el corte apellido/nombre es ambiguo, asi que se prueban todos
// los cortes y combinaciones (el Motor solo acepta coincidencia exacta o unica en la tabla Elo).
function candidatosNombre(slug) {
  const t = slug.split('-').filter(Boolean);
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const vistos = new Set(); const out = [];
  const add = (x) => { if (!vistos.has(x)) { vistos.add(x); out.push(x); } };
  for (let i = 1; i < t.length; i++) {
    const ape = t.slice(0, i).map(cap);
    const pila = t.slice(i).map(cap);
    const gs = [pila.join(' '), pila[0], pila[pila.length - 1]];
    const ss = [ape.join(' '), ape[0], ape[ape.length - 1]];
    for (const g of gs) for (const s of ss) add(g + ' ' + s);
  }
  if (t.length === 1) add(cap(t[0]));
  return out;
}

module.exports = { listaPartidos, cuotasBet365, candidatosNombre, sleep };
