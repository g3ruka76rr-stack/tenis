'use strict';
// Tuberia completa: Flashscore (partidos + cuotas Bet365) -> Motor -> regla final -> data.json
// Regla (decision del usuario): solo WTA/WTA125; ambas cuotas < 3.00; sin SIN_ELO; Motor con stake 4-5 EUR:
//   * stake 4-5 en la no favorita -> apostar NF directa
//   * stake 4-5 en la favorita    -> INVERTIR: apostar NF con los mismos euros
const fs = require('fs');
const path = require('path');
const F = require('./flashscore.js');
const A = require('./analizar.js');
const { Motor } = A;

const SOLO_NO_EMPEZADOS = process.env.TODOS !== '1';

function fechaMadrid(ts) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts * 1000));
}
function horaMadrid(ts) {
  return new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts * 1000));
}
function diaAntes(iso) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
const r3 = (x) => Math.round(x * 1000) / 1000;

function decidir(res) {
  const pFav = res.pCuotaBase, pNf = 1 - pFav;
  const rF = Motor.calcularEdge(1 / pFav, res.bFav), rN = Motor.calcularEdge(1 / pNf, res.bNf);
  const lado = rF.apostar ? 'fav' : (rN.apostar ? 'nf' : null);
  const out = { pFav, pNf, cuotaJustaFav: 1 / pFav, cuotaJustaNf: 1 / pNf, ladoMotor: lado, eurosMotor: 0, apuesta: null, motivo: null };
  if (!lado) { out.motivo = 'Sin edge (Motor)'; return out; }
  const p = lado === 'fav' ? pFav : pNf, c = lado === 'fav' ? res.bFav : res.bNf, e = (lado === 'fav' ? rF : rN).edge;
  const raw = c * p - 1;
  out.edgeRawMotor = raw;
  out.eurosMotor = raw >= 0.03 ? Motor.stakeEuros(e, 100, p, c, 1.05) : 0;
  if (out.eurosMotor < 4) { out.motivo = `Stake Motor ${out.eurosMotor} € (<4) en ${lado === 'fav' ? 'favorita' : 'no favorita'}`; return out; }
  const eur = out.eurosMotor;
  if (lado === 'nf') {
    const cj = 1 / pNf;
    out.apuesta = { tipo: 'directa', jugadora: res.nf, rival: res.fav, cuota: res.bNf, euros: eur, cuotaJusta: r3(cj), edge: r3(res.bNf / cj - 1) };
    // cuota minima a la que el Motor sigue dando >=4 EUR (para si la cuota real de Bet365 es otra)
    let min4 = null;
    for (let c2 = Math.round(res.bNf * 100); c2 >= 101; c2--) {
      const cc = c2 / 100; const rr = Motor.calcularEdge(cj, cc);
      const rw = cc * pNf - 1;
      const st = (rr.apostar && rw >= 0.03) ? Motor.stakeEuros(rr.edge, 100, pNf, cc, 1.05) : 0;
      if (st >= 4) min4 = cc; else break;
    }
    out.apuesta.cuotaMin4 = min4;
  } else {
    // inversion: misma cantidad en euros, cuota real de la NF; cuotaJusta NF = 1/(1-1/cuotaJustaFav) = 1/pNf
    const cj = 1 / pNf;
    out.apuesta = { tipo: 'invertida', jugadora: res.nf, rival: res.fav, cuota: res.bNf, euros: eur, cuotaJusta: r3(cj), edge: r3(res.bNf / cj - 1),
      cuotaFavOriginal: res.bFav, cuotaJustaFavOriginal: r3(1 / pFav), edgeFavOriginal: r3(res.bFav * pFav - 1) };
  }
  return out;
}

(async () => {
  const t0 = Date.now();
  const ahora = Math.floor(Date.now() / 1000);
  let lista = [];
  for (const d of [0, 1]) lista = lista.concat(await F.listaPartidos(d));
  const vistos = new Set(); lista = lista.filter((m) => !vistos.has(m.id) && vistos.add(m.id));
  const total = lista.length;
  if (SOLO_NO_EMPEZADOS) lista = lista.filter((m) => m.estado === '1' && m.ts > ahora);

  // tabla Elo para resolver nombres
  const { eloTabla, yeloTabla } = await A.getEloTablas('WTA');
  Motor.setCircuito('WTA');
  Motor.cargarTablasElo({ eloWta: eloTabla, yeloWta: yeloTabla });
  const resolver = (slug) => {
    for (const c of F.candidatosNombre(slug)) { const e = Motor.buscarElo(c); if (e) return e.nombre; }
    return null;
  };

  const partidos = [];
  for (const m of lista) {
    const base = {
      id: m.id, ts: m.ts, fecha: fechaMadrid(m.ts), hora: horaMadrid(m.ts), torneo: m.torneo, nivel: m.nivel === 'W125' ? 'WTA 125' : 'WTA',
      superficie: m.sup, interior: m.interior, estadoFS: m.estado,
    };
    const odds = await F.cuotasBet365(m.id); await F.sleep(120);
    const nL = resolver(m.slugLocal), nV = resolver(m.slugVisit);
    const nombreLocal = nL || m.slugLocal, nombreVisit = nV || m.slugVisit;
    if (!odds) { partidos.push({ ...base, jugadoras: [nombreLocal, nombreVisit], estadoApp: 'SIN_CUOTAS', motivo: 'Sin cuotas Bet365 en Flashscore' }); continue; }
    const loc = { n: nombreLocal, c: odds.local }, vis = { n: nombreVisit, c: odds.visit };
    base.cuotas = { [nombreLocal]: odds.local, [nombreVisit]: odds.visit };
    if (odds.local === odds.visit) { partidos.push({ ...base, jugadoras: [nombreLocal, nombreVisit], estadoApp: 'IGUALADAS', motivo: 'Cuotas iguales: no hay favorita definida' }); continue; }
    const fav = odds.local < odds.visit ? loc : vis, nf = odds.local < odds.visit ? vis : loc;
    base.fav = fav.n; base.nf = nf.n; base.bFav = fav.c; base.bNf = nf.c;
    base.aperturaFav = odds.local < odds.visit ? odds.localApertura : odds.visitApertura;
    base.aperturaNf = odds.local < odds.visit ? odds.visitApertura : odds.localApertura;
    if (!(fav.c < 3 && nf.c < 3)) { partidos.push({ ...base, estadoApp: 'CUOTA_3', motivo: 'Una cuota ≥ 3.00 (fuera de la regla)' }); continue; }
    if (!m.sup) { partidos.push({ ...base, estadoApp: 'SIN_SUPERFICIE', motivo: 'Superficie desconocida' }); continue; }
    if (!nL || !nV) { partidos.push({ ...base, estadoApp: 'SIN_ELO', motivo: 'Sin Elo en TennisAbstract para ' + (!nL ? m.slugLocal : m.slugVisit) }); continue; }
    A.setRefDia(diaAntes(base.fecha));
    const mm = { torneo: m.torneo, nivel: 'WTA', superficie: m.sup, fav: fav.n, nf: nf.n, bFav: fav.c, bNf: nf.c };
    let res;
    try { res = await A.analizar(mm); } catch (e) { res = { error: e.message }; }
    if (res.excluido) { partidos.push({ ...base, estadoApp: 'SIN_ELO', motivo: res.excluido + ': ' + (res.avisos || []).join('; ') }); continue; }
    if (res.error || res.pCuotaBase == null) { partidos.push({ ...base, estadoApp: 'ERROR', motivo: res.error || 'Sin probabilidad' }); continue; }
    const dec = decidir(res);
    partidos.push({ ...base, estadoApp: dec.apuesta ? 'APUESTA' : 'SIN_APUESTA', motivo: dec.motivo, ...dec,
      bloques: res.bloques, bloquesCompletos: res.bloquesCompletos, bloquesTotal: res.bloquesTotal, avisos: res.avisos });
    process.stderr.write(`${base.torneo} ${fav.n} vs ${nf.n} -> ${dec.apuesta ? 'APUESTA ' + dec.apuesta.jugadora + ' ' + dec.apuesta.euros + '€' : dec.motivo}\n`);
  }
  partidos.sort((a, b) => a.ts - b.ts);
  const out = { generado: new Date().toISOString(), generadoMadrid: horaMadrid(ahora) + ' ' + fechaMadrid(ahora), partidosFeed: total, analizados: partidos.length, partidos };
  const dest = process.env.OUT || path.join(__dirname, 'data.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 1));
  process.stderr.write(`LISTO ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${dest}\n`);
})().catch((e) => { console.error('FALLO', e); process.exit(1); });
