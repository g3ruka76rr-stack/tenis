'use strict';
// ============================================================================
// scrapers/tennisratio.js
// ----------------------------------------------------------------------------
// TennisRatio tambien sirve los datos reales embebidos en el HTML server-
// renderizado (confirmado 2026-09-17): cada pagina de jugador/a
// (tennisratio.com/players/<Nombre>.html) trae:
//   - window.__initialStats: agregado YA CALCULADO por TennisRatio de los
//     ULTIMOS 365 DIAS, TODAS LAS SUPERFICIES (verificado contando fechas
//     reales en window.matchesData: matches_played coincide exacto con el
//     numero de partidos de los ultimos 365 dias). Incluye Dominance Ratio,
//     Breakpoints Prevail, Match/Dominance Efficiency, Pressure Points
//     (serve/return) y el desglose "Odds Performance" por tramo de cuota
//     (surety/favorite/slightfav/slightunder/under/underdog).
//   - window.matchesData: TODO el historial partido a partido (fecha,
//     superficie, aces, dobles faltas, breakpoints_saved_count "9/12",
//     breakpoints_converted_count "1/3", serve_pressure_all/won,
//     return_pressure_all/won, cuota propia/rival, etc.) -- con esto se
//     puede recalcular cualquier agregado para una SUPERFICIE concreta
//     (cosa que la pagina no ofrece ya calculada), o para el H2H directo.
// La pagina de comparacion (h2h-compare/<a>-vs-<b>.html) trae los mismos dos
// bloques por cada jugador/a (window.player1MatchesData/player2MatchesData)
// mas la lista de precedentes directos.
// ============================================================================
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' al pedir ' + url);
  return res.text();
}

// slugJugador: "Iga Swiatek" -> "IgaSwiatek" (paginas /players/) y
// "iga-swiatek" (paginas /h2h-compare/), TennisRatio usa las dos variantes.
function slugCamel(nombreCompleto) {
  return nombreCompleto.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z\s]/g, '').split(/\s+/).join('');
}
function slugGuiones(nombreCompleto) {
  return nombreCompleto.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z\s-]/g, '').trim().replace(/\s+/g, '-');
}

function extraerObjetoEmbebido(html, nombreVar) {
  const marca = 'window.' + nombreVar;
  const i = html.indexOf(marca);
  if (i === -1) return null;
  const eq = html.indexOf('=', i);
  // localizar el primer '{' o '[' tras el '='
  let p = eq + 1;
  while (/\s/.test(html[p])) p++;
  const abre = html[p];
  const cierra = abre === '{' ? '}' : ']';
  if (abre !== '{' && abre !== '[') return null;
  let depth = 0, k = p;
  while (true) {
    if (html[k] === abre) depth++;
    else if (html[k] === cierra) { depth--; if (depth === 0) { k++; break; } }
    k++;
    if (k > html.length) return null;
  }
  let raw = html.slice(p, k);
  // TennisRatio incrusta a veces literales NaN/Infinity (validos en JS, invalidos en JSON) --
  // se normalizan a null antes de parsear, en vez de descartar todo el objeto.
  raw = raw.replace(/:\s*NaN/g, ': null').replace(/:\s*-?Infinity/g, ': null');
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// AÑADIDO (2026-09-18, quinta vuelta -- caso real Kabbaj/Papamichail, "Pero por que yo si la
// consigo con la copia y pega?"): la pagina del jugador/a trae TAMBIEN window.playerData, con
// los agregados YA CALCULADOS POR SUPERFICIE por el propio servidor de TennisRatio (sub-objetos
// ovr/hard/clay/grass, mas pressure_ovr/pressure_hard/pressure_clay/pressure_grass para Pressure
// Points) -- es EXACTAMENTE el mismo dato que el usuario copia y pega a mano cuando filtra por
// superficie en la web (verificado exacto: clay.match_eff_ratio=1.09117... == "1.091" del panel
// real, clay.matches_played=42 == "42" del panel). Hasta ahora el scraper solo leia
// __initialStats (que es SIEMPRE global, nunca cambia con el filtro) y reconstruia el filtro de
// superficie a mano sumando partido a partido (agregarVentana) -- una aproximacion que ya no
// hace falta para los campos que playerData trae directamente.
function extraerPlayerData(html) {
  return extraerObjetoEmbebido(html, 'playerData');
}
const SUPERFICIE_APP_A_PLAYERDATA = { D: 'hard', T: 'clay', H: 'grass' };

async function descargarFichaJugador(nombreCompleto) {
  const url = 'https://www.tennisratio.com/players/' + slugCamel(nombreCompleto) + '.html';
  const html = await fetchText(url);
  const initialStats = extraerObjetoEmbebido(html, '__initialStats');
  const matchesData = extraerObjetoEmbebido(html, 'matchesData');
  const playerData = extraerPlayerData(html);
  return { url, initialStats, playerData, matches: (matchesData && matchesData.matches) || matchesData || [] };
}

async function descargarH2H(nombreA, nombreB) {
  const url = 'https://www.tennisratio.com/h2h-compare/' + slugGuiones(nombreA) + '-vs-' + slugGuiones(nombreB) + '.html';
  const html = await fetchText(url);
  const p1 = extraerObjetoEmbebido(html, 'player1MatchesData');
  const p2 = extraerObjetoEmbebido(html, 'player2MatchesData');
  return {
    url,
    matchesA: (p1 && p1.matches) || [],
    matchesB: (p2 && p2.matches) || [],
  };
}

// ---------------------------------------------------------------------------
// Agregados calculados a partir de partidos crudos (para la ventana
// SUPERFICIE-ESPECIFICA de los ultimos 52 semanas, que TennisRatio no sirve
// ya calculada). Formulas replicando las que la propia web explica:
//   Dominance Ratio      = suma(BP creados)      / suma(BP enfrentados en el saque)
//   Breakpoints Prevail  = suma(BP convertidos)  / suma(BP perdidos en el saque)
// (BP creados/convertidos vienen de "breakpoints_converted_count" tipo "1/3";
//  BP enfrentados/salvados de "breakpoints_saved_count" tipo "9/12"; BP
//  perdidos en el saque = enfrentados - salvados.)
// ---------------------------------------------------------------------------
function partirFraccion(str) {
  if (!str || typeof str !== 'string' || !str.includes('/')) return null;
  const [a, b] = str.split('/').map(Number);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return { ganados: a, total: b };
}

function esTiebreakEnScore(score) {
  // TennisRatio da el score como "4-6 7-5 2-6" (sin detalle del propio TB),
  // asi que se detecta indirectamente: sets 7-6 o 6-7 casi siempre llevan TB.
  return /7-6|6-7/.test(score || '');
}

// hastaFecha (AÑADIDO 2026-09-17, fallo real critico detectado): sin tope superior, un partido
// de HOY MISMO que ya se ha jugado y cerrado en TennisRatio (la propia jugadora ya tiene el
// resultado real de ESTE partido metido en su Match History en el momento de hacer el scraping)
// se colaba como "el partido mas reciente" en toda la forma historica -- con peso maximo
// (diasAgo=0 -> peso=1.0, el mayor de todos) contaminando la prediccion con el resultado real
// del propio partido que se esta intentando predecir. hastaFecha excluye cualquier partido con
// fecha >= la fecha de referencia (hoy/la fecha del partido de hoy), igual en todas las
// ventanas (global, superficie, odds performance).
function filtrarPartidos(matches, { superficie, desdeFecha, hastaFecha }) {
  return matches.filter(m => {
    if (desdeFecha && m.date < desdeFecha) return false;
    if (hastaFecha && m.date >= hastaFecha) return false;
    if (superficie && (m.surface || '').toLowerCase() !== superficie.toLowerCase()) return false;
    return true;
  });
}

function agregarVentana(matches) {
  let bpCreados = 0, bpEnfrentados = 0, bpConvertidos = 0, bpPerdidos = 0;
  let aces = 0, df = 0, spAll = 0, spWon = 0, rpAll = 0, rpWon = 0;
  let juegosSaquePropios = 0; // ARREGLADO (2026-09-17, confirmado contra un pegado real del
  // usuario): TennisRatio da "Aces per Game" y "Double Faults per Game" POR JUEGO DE SAQUE
  // PROPIO, no por partido (0.53 aces/juego para Sabalenka en dura, NO 5.59 aces/partido que
  // daba la primera version de este scraper -- confirmado comparando contra la pagina de
  // comparacion real que pegó el usuario, coincidencia exacta en DR/Prevail/PressurePoints/
  // BP%, solo aces/df estaban en la unidad equivocada). "service_games_won" trae "12/15" -- el
  // denominador (15) es el total de juegos de saque propios de ESE partido, se usa como
  // divisor en vez del numero de partidos.
  let tbConTB = 0, tbGanados = 0;
  let n = 0;
  for (const m of matches) {
    const salv = partirFraccion(m.breakpoints_saved_count);   // enfrentado en el propio saque
    const conv = partirFraccion(m.breakpoints_converted_count); // creado sobre el resto
    const juegosSaque = partirFraccion(m.service_games_won);
    if (salv) { bpEnfrentados += salv.total; bpPerdidos += (salv.total - salv.ganados); }
    if (conv) { bpCreados += conv.total; bpConvertidos += conv.ganados; }
    if (juegosSaque) juegosSaquePropios += juegosSaque.total;
    if (typeof m.aces === 'number') aces += m.aces;
    if (typeof m.double_faults === 'number') df += m.double_faults;
    if (typeof m.serve_pressure_all === 'number') { spAll += m.serve_pressure_all; spWon += (m.serve_pressure_won || 0); }
    if (typeof m.return_pressure_all === 'number') { rpAll += m.return_pressure_all; rpWon += (m.return_pressure_won || 0); }
    if (esTiebreakEnScore(m.score)) {
      tbConTB++;
      // Aproximacion: si el marcador de set esta en 7-6 a favor / 6-7 en contra en CUALQUIER
      // set, se cuenta como TB ganado/perdido segun el resultado de ESE set, no del partido.
      const sets = (m.score || '').split(' ');
      for (const s of sets) {
        if (s === '7-6') tbGanados++;
        // 6-7 = tiebreak perdido, no se suma a tbGanados (ya se cuenta en tbConTB via jugados)
      }
    }
    n++;
  }
  return {
    n,
    trDominanceRatio: bpEnfrentados > 0 ? (bpCreados / bpEnfrentados) : null,
    trBreakpointsPrevail: bpPerdidos > 0 ? (bpConvertidos / bpPerdidos) : null,
    ppServe: spAll > 0 ? (spWon / spAll) : null,
    ppReturn: rpAll > 0 ? (rpWon / rpAll) : null,
    aces: juegosSaquePropios > 0 ? (aces / juegosSaquePropios) : null,   // por JUEGO DE SAQUE propio
    df: juegosSaquePropios > 0 ? (df / juegosSaquePropios) : null,       // por JUEGO DE SAQUE propio
    bpSalvados: bpEnfrentados > 0 ? (1 - bpPerdidos / bpEnfrentados) : null, // % de BP salvados
    bpConvertidos: bpCreados > 0 ? (bpConvertidos / bpCreados) : null,       // % de BP convertidos
    tbGanados, tbJugados: tbConTB,
  };
}

// odds performance: bucket por cuota propia del partido, ganados/jugados por tramo, sobre la
// MISMA ventana de 52 semanas / todas las superficies que usa __initialStats (para que
// coincida con los tramos definidos en REFERENCIA_TRAMO_CUOTA del motor: <=1.20, <=1.50, resto).
// ARREGLADO (2026-09-17, confirmado con 2 pegados reales de la pagina de comparacion del
// usuario -- Masarova "Clear favourite 1.20-1.50: 3W-4L" + "Slight favourite >1.50: 4W-1L" =
// EXACTO n=7/n=5 que esperaba; Herrero Linana "Strong 4W-1L / Clear 8W-2L / Slight 7W-5L" =
// EXACTO n=5/n=10/n=12): la tabla "Odds Performance Comparison" de TennisRatio (y el parser
// de la app, parseOddsPerformanceBracketsTennisRatio) SOLO cuenta los 3 tramos de "favourite"
// (Strong/Clear/Slight, cuota propia < cuota rival) -- las 3 filas espejo "Not a favourite"/
// "Pre-match underdog" (cuando la propia cuota es MAYOR que la de la rival, es decir cuando la
// jugadora fue la NO favorita de ese partido historico) NO se usan nunca, ni se parsean. Sin
// este filtro, un partido donde la jugadora fue clara no-favorita con cuota propia alta se
// colaba igual en el tramo "Infinity" (cuota propia > 1.50), inflando muchisimo la muestra
// real (confirmado: 39 partidos calculados vs 12 reales de Herrero Linana en el tramo Infinity).
function calcularOddsPerformance(matches) {
  // Frontera EXACTA confirmada con pegado real (Masarova, cuota propia = 1.20 en un partido:
  // cae en "Clear favourite 1.20-1.50", NO en "Strong favourite < 1.20" -- "Strong" es
  // estrictamente menor que 1.20, "Clear" incluye el 1.20 exacto).
  const tramos = [{ max: 1.20, estricto: true }, { max: 1.50, estricto: false }, { max: Infinity, estricto: false }];
  const acc = {};
  for (const t of tramos) acc[t.max] = { w: 0, n: 0 };
  for (const m of matches) {
    const odd = m.player_odd;
    if (!odd || odd <= 1) continue;
    if (m.rival_odd != null && odd > m.rival_odd) continue; // no favorita ese partido -- TR no lo cuenta aqui
    const t = tramos.find(t => t.estricto ? odd < t.max : odd <= t.max);
    if (!t) continue;
    acc[t.max].n++;
    if (m.result === 'Win') acc[t.max].w++;
  }
  return acc;
}

// superficieAppATr: mapea D/T/H (codigo de la app) a Hard/Clay/Grass (TennisRatio).
const SUPERFICIE_APP_A_TR = { D: 'Hard', T: 'Clay', H: 'Grass' };

// matchParaHistorial: convierte un partido crudo de matchesData (mismos campos exactos que
// muestra la pagina "Match History" que el usuario pega a mano) al formato que espera
// Motor.calcularFormaHistoricaTennisRatio (fecha Date, rankRival, aces, df, bpSalvados/bpFaced,
// holdGames/holdGamesTotal, bpConvertidos/bpCreados, breakGames/breakGamesTotal) -- confirmado
// campo a campo contra parsearTennisRatioMatchHistory() de la app (misma fuente de datos).
function matchParaHistorial(m) {
  const salv = partirFraccion(m.breakpoints_saved_count);
  const conv = partirFraccion(m.breakpoints_converted_count);
  const hold = partirFraccion(m.service_games_won);
  const ret = partirFraccion(m.return_games_won);
  return {
    fecha: m.date ? new Date(m.date) : null,
    rankRival: typeof m.rival_rank === 'number' ? m.rival_rank : null,
    aces: typeof m.aces === 'number' ? m.aces : null,
    df: typeof m.double_faults === 'number' ? m.double_faults : null,
    bpSalvados: salv ? salv.ganados : null, bpFaced: salv ? salv.total : null,
    bpConvertidos: conv ? conv.ganados : null, bpCreados: conv ? conv.total : null,
    holdGames: hold ? hold.ganados : null, holdGamesTotal: hold ? hold.total : null,
    breakGames: ret ? ret.ganados : null, breakGamesTotal: ret ? ret.total : null,
  };
}

// historialFormaTennisRatio: reconstruye STATE.historialFormaTR de la app (forma reciente real,
// ponderada por fecha con ajuste por fuerza del rival) a partir del Match History (ultimas 52
// semanas) de una jugadora, separado en superficie-especifica y todas-superficies -- exactamente
// las DOS pestañas que el usuario pega a mano ("all" y la superficie del partido). Requiere
// Motor (src/motor.js) para calcularFormaHistoricaTennisRatio/ajustarPorFuerzaRival.
function historialFormaTennisRatio(Motor, ficha, superficieApp, fechaReferenciaISO, rankRivalHoy) {
  const fechaReferencia = fechaReferenciaISO ? new Date(fechaReferenciaISO) : new Date();
  const desde52sem = new Date(fechaReferencia.getTime() - 52 * 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const superficieTR = SUPERFICIE_APP_A_TR[superficieApp] || null;
  const hastaHoy = fechaReferencia.toISOString().slice(0, 10);
  const partidosGlobal = filtrarPartidos(ficha.matches, { desdeFecha: desde52sem, hastaFecha: hastaHoy }).map(matchParaHistorial);
  const partidosSuperficie = filtrarPartidos(ficha.matches, { superficie: superficieTR, desdeFecha: desde52sem, hastaFecha: hastaHoy }).map(matchParaHistorial);
  return {
    global: Motor.calcularFormaHistoricaTennisRatio(partidosGlobal, fechaReferencia, rankRivalHoy),
    superficie: Motor.calcularFormaHistoricaTennisRatio(partidosSuperficie, fechaReferencia, rankRivalHoy),
  };
}

async function statsJugadorParaMotor(nombreCompleto, superficieApp, fechaReferenciaISO) {
  const ficha = await descargarFichaJugador(nombreCompleto);
  if (!ficha.initialStats) {
    return { error: 'sin_datos', url: ficha.url };
  }
  const desde = fechaReferenciaISO
    ? new Date(new Date(fechaReferenciaISO).getTime() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    : null;
  const hastaHoy = fechaReferenciaISO ? new Date(fechaReferenciaISO).toISOString().slice(0, 10) : null;
  const superficieTR = SUPERFICIE_APP_A_TR[superficieApp] || null;
  const partidosVentanaSuperficie = filtrarPartidos(ficha.matches, { superficie: superficieTR, desdeFecha: desde, hastaFecha: hastaHoy });
  const ventanaSuperficie = agregarVentana(partidosVentanaSuperficie); // fallback si playerData no esta disponible
  const g = ficha.initialStats; // global (todas superficies) -- ultimo fallback

  // CORREGIDO DE NUEVO (2026-09-18, quinta vuelta -- "Pero por que yo si la consigo con la copia
  // y pega?"): el usuario confirmo que SIEMPRE pega el oficial filtrado por la superficie del
  // partido. La cuarta vuelta ya cambio el criterio a superficie, pero seguia reconstruyendola a
  // mano con agregarVentana() sobre los partidos crudos -- una aproximacion, con su propio error
  // (p.ej. Match Efficiency no se podia replicar en absoluto, formula desconocida). Se ha
  // encontrado que la pagina SI trae el agregado ya calculado por superficie por el propio
  // servidor de TennisRatio: window.playerData.{hard,clay,grass} (+ pressure_hard/pressure_clay/
  // pressure_grass para Pressure Points) -- es el MISMO dato exacto que el usuario copia a mano
  // (verificado: playerData.clay.match_eff_ratio=1.09117 == "1.091" del panel real,
  // matches_played=42 == "42" del panel, serve_pressure_avg=51.39/return_pressure_avg=50.20 ==
  // "0.514"/"0.502" del panel). Se usa esto como fuente principal; agregarVentana()/__initialStats
  // quedan solo como fallback si playerData no estuviera disponible (pagina cambia de formato,
  // jugador/a sin suficientes partidos en esa superficie, etc.).
  const pd = ficha.playerData;
  const pdKey = SUPERFICIE_APP_A_PLAYERDATA[superficieApp] || null;
  const pdSup = pd && pdKey ? pd[pdKey] : null;
  const pdPressureSup = pd && pdKey ? pd['pressure_' + pdKey] : null;
  const num = (v) => (v == null ? null : parseFloat(v));

  const trPartidosVentana = pdSup ? num(pdSup.matches_played) : ventanaSuperficie.n || 0;
  const trDominanceRatio = pdSup && num(pdSup.dominance_ratio) != null ? num(pdSup.dominance_ratio)
    : (ventanaSuperficie.trDominanceRatio != null ? ventanaSuperficie.trDominanceRatio : g.dominance_ratio);
  const trBreakpointsPrevail = pdSup && num(pdSup.breakpoints_prevail_ratio) != null ? num(pdSup.breakpoints_prevail_ratio)
    : (ventanaSuperficie.trBreakpointsPrevail != null ? ventanaSuperficie.trBreakpointsPrevail : g.breakpoints_prevail_ratio);
  const trMatchEfficiency = pdSup && num(pdSup.match_eff_ratio) != null ? num(pdSup.match_eff_ratio)
    : (g.match_eff_ratio != null ? g.match_eff_ratio : null); // ya no hay limitacion: playerData lo trae por superficie
  const ppServe = pdPressureSup && num(pdPressureSup.serve_pressure_avg) != null ? num(pdPressureSup.serve_pressure_avg) / 100
    : (ventanaSuperficie.ppServe != null ? ventanaSuperficie.ppServe : (g.serve_pressure_avg != null ? g.serve_pressure_avg / 100 : null));
  const ppReturn = pdPressureSup && num(pdPressureSup.return_pressure_avg) != null ? num(pdPressureSup.return_pressure_avg) / 100
    : (ventanaSuperficie.ppReturn != null ? ventanaSuperficie.ppReturn : (g.return_pressure_avg != null ? g.return_pressure_avg / 100 : null));
  const bpSalvados = pdSup && num(pdSup.breakpoints_saved_ratio) != null ? num(pdSup.breakpoints_saved_ratio) / 100
    : (ventanaSuperficie.bpSalvados != null ? ventanaSuperficie.bpSalvados : (g.breakpoints_saved_ratio != null ? g.breakpoints_saved_ratio / 100 : null));
  const bpConvertidos = pdSup && num(pdSup.breakpoints_converted_ratio) != null ? num(pdSup.breakpoints_converted_ratio) / 100
    : (ventanaSuperficie.bpConvertidos != null ? ventanaSuperficie.bpConvertidos : (g.breakpoints_converted_ratio != null ? g.breakpoints_converted_ratio / 100 : null));

  // Odds Performance: playerData tambien trae surety/favorite/slightfav/slightunder/under/
  // underdog ya bucketizados por superficie, pero con una taxonomia de 6 tramos que no se ha
  // verificado todavia contra los 3 tramos que usa la matriz (Strong/Clear/Slight, solo cuando la
  // jugadora fue favorita ese partido) -- se mantiene calcularOddsPerformance() sobre los
  // partidos crudos filtrados a la superficie (ya corregido en la vuelta anterior) hasta verificar
  // esa correspondencia con un pegado real.
  const oddsPerf = calcularOddsPerformance(partidosVentanaSuperficie);

  return {
    url: ficha.url,
    trPartidosVentana,
    trDominanceRatio,
    trBreakpointsPrevail,
    trMatchEfficiency,
    ppServe,
    ppReturn,
    aces: null,
    df: null,
    bpSalvados,
    bpConvertidos,
    tbGanados: ventanaSuperficie.tbGanados,
    tbJugados: ventanaSuperficie.tbJugados,
    trOddsPerformance: oddsPerf,
    _ventanaSuperficie: ventanaSuperficie,
    _playerDataSuperficie: pdSup,
    _global365: g,
  };
}

module.exports = {
  slugCamel, slugGuiones,
  descargarFichaJugador, descargarH2H,
  filtrarPartidos, agregarVentana, calcularOddsPerformance,
  statsJugadorParaMotor, matchParaHistorial, historialFormaTennisRatio,
  SUPERFICIE_APP_A_TR,
};
