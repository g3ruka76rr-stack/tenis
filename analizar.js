'use strict';
const path = require('path');
const Motor = require(path.join(__dirname, 'motor.js'));
const TA = require(path.join(__dirname, 'tennisabstract.js'));
const TR = require(path.join(__dirname, 'tennisratio.js'));
const SUPERFICIE_TABLA = { D: 'Hard', T: 'Clay', H: 'Grass' };
const MIN_PARTIDOS_TR_RECIENTE = 3;

// Extraidas de las 14 capturas Bet365 (05-06 oct 2026): WTA Suzhou, WTA Samsun, WTA Pekin,
// Masters de Shanghai, ATP Tokio, ATP Pekin. Filtro objetivo: cuota < 3.00 en ambos lados
// (3.00 exacto NO vale). Excluido por ya estar pendiente en el historico: Sonay Kartal vs
// Alina Charaeva (Pekin WTA) -- ya en historico como pendiente desde el lote anterior.
let REF_DIA='2026-10-12';
function setRefDia(d){REF_DIA=d;}
const eloCache = {};
const playerCache = {};

async function getEloTablas(circuito) {
  if (!eloCache[circuito]) {
    const [eloTabla, yeloTabla] = await Promise.all([
      TA.descargarEloRatings(circuito),
      TA.descargarYEloRatings(circuito),
    ]);
    eloCache[circuito] = { eloTabla, yeloTabla };
  }
  return eloCache[circuito];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getPlayerData(circuito, nombreCanonico, superficie) {
  const key = circuito + '|' + nombreCanonico + '|' + superficie;
  if (!playerCache[key]) {
    playerCache[key] = (async () => {
      let intentos = 0;
      while (true) {
        intentos++;
        try {
          const [splits, tr, ficha] = await Promise.all([
            TA.descargarSplitsJugador(nombreCanonico, superficie),
            TR.statsJugadorParaMotor(nombreCanonico, superficie, REF_DIA),
            TR.descargarFichaJugador(nombreCanonico),
          ]);
          return { splits, tr, ficha };
        } catch (e) {
          if (intentos < 4 && /429/.test(e.message || '')) {
            await sleep(3000 * intentos);
            continue;
          }
          throw e;
        }
      }
    })();
  }
  return playerCache[key];
}

async function analizar(m) {
  const circuito = m.nivel === 'ATP' ? 'ATP' : 'WTA';
  Motor.setCircuito(circuito);
  Motor.setNivel(m.nivel);
  const { eloTabla, yeloTabla } = await getEloTablas(circuito);
  Motor.cargarTablasElo(circuito === 'ATP' ? { eloAtp: eloTabla, yeloAtp: yeloTabla } : { eloWta: eloTabla, yeloWta: yeloTabla });

  const entradaEloFav = Motor.buscarElo(m.fav);
  const entradaEloNf = Motor.buscarElo(m.nf);
  const avisos = [];
  if (!entradaEloFav) avisos.push(`Sin Elo para "${m.fav}"`);
  if (!entradaEloNf) avisos.push(`Sin Elo para "${m.nf}"`);

  if (!entradaEloFav || !entradaEloNf) {
    return { ...m, excluido: 'SIN_ELO', avisos };
  }

  const nombreCanonicoFav = entradaEloFav.nombre;
  const nombreCanonicoNf = entradaEloNf.nombre;

  let datFav, datNf;
  try {
    [datFav, datNf] = await Promise.all([
      getPlayerData(circuito, nombreCanonicoFav, m.superficie),
      getPlayerData(circuito, nombreCanonicoNf, m.superficie),
    ]);
  } catch (e) {
    return { ...m, error: 'fetch_fallo: ' + e.message, avisos };
  }
  const splitsFav = datFav.splits, trFav = datFav.tr, fichaFav = datFav.ficha;
  const splitsNf = datNf.splits, trNf = datNf.tr, fichaNf = datNf.ficha;

  const eloFavSup = Motor.eloParaSuperficie(entradaEloFav, m.superficie);
  const eloNfSup = Motor.eloParaSuperficie(entradaEloNf, m.superficie);
  const eloFavConYElo = Motor.calcularYEloPonderado(m.fav, eloFavSup);
  const eloNfConYElo = Motor.calcularYEloPonderado(m.nf, eloNfSup);
  const pElo = (eloFavConYElo != null && eloNfConYElo != null) ? Motor.probEloGana(eloFavConYElo, eloNfConYElo) : null;
  if (eloFavConYElo == null) avisos.push(`Sin yElo-ponderado para "${m.fav}"`);
  if (eloNfConYElo == null) avisos.push(`Sin yElo-ponderado para "${m.nf}"`);

  const rankRivalHoyParaFav = entradaEloNf ? entradaEloNf.wtaRank : null;
  const rankRivalHoyParaNf = entradaEloFav ? entradaEloFav.wtaRank : null;
  const historialFav = TR.historialFormaTennisRatio(Motor, fichaFav, m.superficie, REF_DIA, rankRivalHoyParaFav);
  const historialNf = TR.historialFormaTennisRatio(Motor, fichaNf, m.superficie, REF_DIA, rankRivalHoyParaNf);

  const superficieWord = SUPERFICIE_TABLA[m.superficie];
  const hoy = new Date(REF_DIA+'T00:00:00Z');
  const drRecienteFavSup = Motor.calcularFormaHistoricaTA_DR(splitsFav && splitsFav.resultadosRecientes, hoy, superficieWord);
  const drRecienteFavGlob = Motor.calcularFormaHistoricaTA_DR(splitsFav && splitsFav.resultadosRecientes, hoy, null);
  const drRecienteNfSup = Motor.calcularFormaHistoricaTA_DR(splitsNf && splitsNf.resultadosRecientes, hoy, superficieWord);
  const drRecienteNfGlob = Motor.calcularFormaHistoricaTA_DR(splitsNf && splitsNf.resultadosRecientes, hoy, null);
  const drFavMezclado = Motor.mezclarOficialRecienteGlobal(
    splitsFav && splitsFav.dr, drRecienteFavSup && drRecienteFavSup.dr, drRecienteFavGlob && drRecienteFavGlob.dr,
    splitsFav && splitsFav.partidosSuperficie, drRecienteFavSup && drRecienteFavSup.n, drRecienteFavGlob && drRecienteFavGlob.n
  );
  const drNfMezclado = Motor.mezclarOficialRecienteGlobal(
    splitsNf && splitsNf.dr, drRecienteNfSup && drRecienteNfSup.dr, drRecienteNfGlob && drRecienteNfGlob.dr,
    splitsNf && splitsNf.partidosSuperficie, drRecienteNfSup && drRecienteNfSup.n, drRecienteNfGlob && drRecienteNfGlob.n
  );
  const statsFav = { dr: drFavMezclado, breakPct: splitsFav && splitsFav.breakPct, holdPct: splitsFav && splitsFav.holdPct };
  const statsNf = { dr: drNfMezclado, breakPct: splitsNf && splitsNf.breakPct, holdPct: splitsNf && splitsNf.holdPct };
  const pDominanceRatio = Motor.pDominanceRatioBloqueMatriz(statsFav, statsNf, null, null, m.superficie, '', '', '', '', null);

  const holdPctFavMezclado = Motor.mezclarOficialRecienteGlobal(statsFav.holdPct, historialFav.superficie ? historialFav.superficie.holdPct : null, historialFav.global ? historialFav.global.holdPct : null,
    splitsFav && splitsFav.partidosSuperficie, historialFav.superficie ? historialFav.superficie.nPartidos : null, historialFav.global ? historialFav.global.nPartidos : null);
  const breakPctFavMezclado = Motor.mezclarOficialRecienteGlobal(statsFav.breakPct, historialFav.superficie ? historialFav.superficie.breakPct : null, historialFav.global ? historialFav.global.breakPct : null,
    splitsFav && splitsFav.partidosSuperficie, historialFav.superficie ? historialFav.superficie.nPartidos : null, historialFav.global ? historialFav.global.nPartidos : null);
  const holdPctNfMezclado = Motor.mezclarOficialRecienteGlobal(statsNf.holdPct, historialNf.superficie ? historialNf.superficie.holdPct : null, historialNf.global ? historialNf.global.holdPct : null,
    splitsNf && splitsNf.partidosSuperficie, historialNf.superficie ? historialNf.superficie.nPartidos : null, historialNf.global ? historialNf.global.nPartidos : null);
  const breakPctNfMezclado = Motor.mezclarOficialRecienteGlobal(statsNf.breakPct, historialNf.superficie ? historialNf.superficie.breakPct : null, historialNf.global ? historialNf.global.breakPct : null,
    splitsNf && splitsNf.partidosSuperficie, historialNf.superficie ? historialNf.superficie.nPartidos : null, historialNf.global ? historialNf.global.nPartidos : null);

  const faltanSplitsFav = statsFav.holdPct == null && statsFav.breakPct == null;
  const faltanSplitsNf = statsNf.holdPct == null && statsNf.breakPct == null;
  let pHoldBreakIndex = null;
  if (!faltanSplitsFav && !faltanSplitsNf) {
    const holdBreakFav = Motor.combinarHoldBreakLogOdds(holdPctFavMezclado, breakPctNfMezclado, circuito);
    const holdBreakNf = Motor.combinarHoldBreakLogOdds(holdPctNfMezclado, breakPctFavMezclado, circuito);
    pHoldBreakIndex = Motor.pHoldBreakIndexBloqueMatriz(holdBreakFav, holdBreakNf, null, null, null, null, null, null);
  } else {
    avisos.push(`Hold-Break Index omitido (splits TA incompletos para ${faltanSplitsFav ? m.fav : m.nf})`);
  }

  function mezclarCamposTR(oficial, historial) {
    const supOk = historial.superficie && historial.superficie.nPartidos >= MIN_PARTIDOS_TR_RECIENTE;
    const globOk = historial.global && historial.global.nPartidos >= MIN_PARTIDOS_TR_RECIENTE;
    const out = { ...oficial };
    if (supOk || globOk) {
      for (const c of ['bpConvertidos', 'bpSalvados', 'trDominanceRatio', 'trBreakpointsPrevail']) {
        out[c] = Motor.mezclarOficialRecienteGlobal(oficial[c], supOk ? historial.superficie[c] : null, globOk ? historial.global[c] : null,
          null, supOk ? historial.superficie.nPartidos : null, globOk ? historial.global.nPartidos : null);
      }
    }
    return out;
  }
  const statsFavTR = mezclarCamposTR({ ...statsFav, ...trFav, holdPct: holdPctFavMezclado, breakPct: breakPctFavMezclado }, historialFav);
  const statsNfTR = mezclarCamposTR({ ...statsNf, ...trNf, holdPct: holdPctNfMezclado, breakPct: breakPctNfMezclado }, historialNf);
  const pSofascoreMicro = Motor.pSofascoreMicroBloqueMatriz(statsFavTR, statsNfTR);
  const pTennisRatioDominance = Motor.pTennisRatioDominanceBloqueMatriz(statsFavTR, statsNfTR);
  const pPressurePoints = Motor.pPressurePointsBloqueMatriz(statsFavTR, statsNfTR);

  const pMercadoBet365 = Motor.pMercadoBet365BloqueMatriz(m.bFav, m.bNf);

  let pCuotaBase = Motor.calcularProbabilidadFinalPonderada({
    pElo, pDominanceRatio, pHoldBreakIndex, pSofascoreMicro, pTennisRatioDominance, pPressurePoints, pMercadoBet365,
  });
  if (pCuotaBase != null) {
    pCuotaBase = Motor.ajustarPorMatchEfficiency(pCuotaBase, statsFavTR, statsNfTR);
    pCuotaBase = Motor.ajustarPorOddsPerformance(pCuotaBase, statsFavTR, statsNfTR, m.bFav, m.bNf);
  }

  const bloques = { pElo, pDominanceRatio, pHoldBreakIndex, pSofascoreMicro, pTennisRatioDominance, pPressurePoints, pMercadoBet365 };
  const bloquesCompletos = Object.values(bloques).filter(v => v != null).length;
  const bloquesTotal = Object.keys(bloques).length;

  let edgeFav = null, edgeNf = null, apostarFav = false, apostarNf = false;
  if (pCuotaBase != null) {
    const resFav = Motor.calcularEdge(1 / pCuotaBase, m.bFav);
    const resNf = Motor.calcularEdge(1 / (1 - pCuotaBase), m.bNf);
    edgeFav = resFav.edge; apostarFav = resFav.apostar;
    edgeNf = resNf.edge; apostarNf = resNf.apostar;
  }

  return {
    ...m, nombreCanonicoFav, nombreCanonicoNf,
    bloques, bloquesCompletos, bloquesTotal,
    pCuotaBase, edgeFav, edgeNf, apostarFav, apostarNf,
    avisos,
  };
}






module.exports={analizar,getEloTablas,setRefDia,Motor,TA,TR};
