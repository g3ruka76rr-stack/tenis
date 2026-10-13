// ============================================================================
// motor.js -- Motor de calculo PORTADO 1:1 desde PISTA_VERDE (la app HTML).
// Estas NO son formulas reescritas a mano: son las funciones puras exactas
// extraidas del archivo original (mismos comentarios, mismos numeros), solo
// adaptadas para correr en Node sin DOM/localStorage. Cualquier cambio de
// formula en la app debe reflejarse aqui volviendo a extraer con extract.py
// (ver README) para que los dos motores no diverjan con el tiempo.
//
// Dependencias externas que la app resuelve via DOM/localStorage y aqui se
// resuelven via un objeto STATE sencillo + tablas ELO/yELO inyectadas:
//   - STATE.circuit ('ATP'|'WTA') y STATE.level ('ATP'|'CH'|'WTA'|'W100'|'W75')
//   - ELO_WTA/ELO_ATP/YELO_WTA/YELO_ATP: arrays cargados por src/tennisabstract.js
// ============================================================================
'use strict';

const STATE = { circuit: 'WTA', level: 'WTA' };
let ELO_WTA = [], ELO_ATP = [], YELO_WTA = [], YELO_ATP = [];
let _prngSimulacion = Math.random; // se reasigna al principio de cada probGanaPartido()

function setCircuito(c) { STATE.circuit = c; }
function setNivel(l) { STATE.level = l; }
function cargarTablasElo({ eloWta, eloAtp, yeloWta, yeloAtp }) {
  if (eloWta) ELO_WTA = eloWta;
  if (eloAtp) ELO_ATP = eloAtp;
  if (yeloWta) YELO_WTA = yeloWta;
  if (yeloAtp) YELO_ATP = yeloAtp;
}

const PESOS_MATRIZ_PONDERADA_CON_MERCADO = Object.freeze({
  elo: 0.40,
  dominanceRatio: 0.24,
  holdBreakIndex: 0.15,
  sofascoreMicro: 0.07,
  tennisRatioDominance: 0.05,
  pressurePoints: 0.04,
  mercadoBet365: 0.05,
});

const PESOS_MATRIZ_PONDERADA_SIN_MERCADO = Object.freeze({
  elo: 0.4263,
  dominanceRatio: 0.2558,
  holdBreakIndex: 0.16,
  sofascoreMicro: 0.07,
  tennisRatioDominance: 0.05,
  pressurePoints: 0.04,
  mercadoBet365: 0,
});

function buscarElo(nombre){
  if (!nombre) return null;
  const tabla = STATE.circuit === 'ATP' ? ELO_ATP : ELO_WTA;
  // BUG CORREGIDO (2026-09-22, caso real: "J.J. Wolf" no encontraba su Elo porque
  // TennisAbstract lo tiene como "J J Wolf" sin puntos -- la normalizacion no los quitaba,
  // asi que ni la coincidencia exacta ni la de primera+ultima palabra (que ademas dejaba
  // "j.j." como una sola palabra en vez de dos iniciales) podian casar nunca. Esto hacia que
  // el bloque Elo+yElo (40% del peso) se omitiera en silencio para cualquier jugador con
  // iniciales con punto, sesgando la cuota base sin ningun aviso salvo el warning de consola.
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[-_.]/g,' ').replace(/\s+/g,' ').trim();
  const objetivo = norm(nombre);
  const exacto = tabla.find(j => norm(j.nombre) === objetivo);
  if (exacto) return exacto;
  // ARREGLADO (2026-08-05, peticion expresa y repetida del usuario, caso real: "Gabriela
  // Knutson" en la app, pero en la lista de ELO esta como "Gabriela Andrea Knutson" -- un
  // segundo nombre de por medio que la coincidencia exacta nunca iba a encontrar). Si falla
  // la coincidencia exacta, se prueba solo con la PRIMERA y la ULTIMA palabra del nombre
  // (nombre + apellido, ignorando cualquier segundo nombre de en medio) -- tolera que el
  // usuario escriba el nombre corto y la lista tenga el nombre completo, o al reves.
  const partes = objetivo.split(' ');
  if (partes.length < 2) return null;
  const primeraYUltima = partes[0] + ' ' + partes[partes.length-1];
  const candidatos = tabla.filter(j => {
    const p = norm(j.nombre).split(' ');
    if (p.length < 2) return false;
    return (p[0] + ' ' + p[p.length-1]) === primeraYUltima;
  });
  if (candidatos.length === 1) return candidatos[0];
  if (candidatos.length > 1) return null; // varias coincidencias con primera+ultima palabra: mejor no adivinar

  // ARREGLADO (2026-09-27, caso real: "Guiomar Maristany Zuleta" no encontraba su Elo porque
  // TennisAbstract la tiene como "Guiomar Maristany Zuleta De Reales" -- un apellido compuesto
  // de 4 palabras hace que "primera+ultima" compare "guiomar zuleta" contra "guiomar reales" y
  // nunca case, aunque el nombre completo introducido sea un PREFIJO EXACTO del de la tabla.
  // Si las dos tecnicas anteriores fallan, se prueba si el nombre buscado son las primeras N
  // palabras del nombre de la tabla (apellido compuesto mas largo de lo esperado), exigiendo
  // coincidencia unica para no adivinar entre varias jugadoras con el mismo nombre de pila.
  const candidatosPrefijo = tabla.filter(j => {
    const p = norm(j.nombre).split(' ');
    if (p.length <= partes.length) return false;
    return p.slice(0, partes.length).join(' ') === objetivo;
  });
  return candidatosPrefijo.length === 1 ? candidatosPrefijo[0] : null;
}

function eloParaSuperficie(entradaElo, superficie){
  if (entradaElo == null) return null;
  const campo = superficie === 'D' ? 'hElo' : superficie === 'T' ? 'cElo' : superficie === 'H' ? 'gElo' : null;
  return (campo && entradaElo[campo] != null) ? entradaElo[campo] : entradaElo.elo;
}

function probEloGana(ratingA, ratingB){
  if (ratingA == null || ratingB == null) return null;
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function buscarYElo(nombre){
  if (!nombre) return null;
  const tabla = STATE.circuit === 'ATP' ? YELO_ATP : YELO_WTA;
  // mismo fix de puntos que buscarElo (ver comentario ahi -- caso real "J.J. Wolf").
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[-_.]/g,' ').replace(/\s+/g,' ').trim();
  const objetivo = norm(nombre);
  const exacto = tabla.find(j => norm(j.nombre) === objetivo);
  if (exacto) return exacto;
  const partes = objetivo.split(' ');
  if (partes.length < 2) return null;
  const primeraYUltima = partes[0] + ' ' + partes[partes.length-1];
  const candidatos = tabla.filter(j => {
    const p = norm(j.nombre).split(' ');
    if (p.length < 2) return false;
    return (p[0] + ' ' + p[p.length-1]) === primeraYUltima;
  });
  return candidatos.length === 1 ? candidatos[0] : null;
}

function pesoYEloPorPartidos(nPartidos){
  const cap = 0.50, k = 10;
  if (nPartidos == null || nPartidos <= 0) return { pesoYElo: 0, pesoSuperficie: 1 };
  const pesoYElo = cap * nPartidos / (nPartidos + k);
  return { pesoYElo, pesoSuperficie: 1 - pesoYElo };
}

function calcularYEloPonderado(nombreJugadora, eloSuperficie){
  const yeloEntrada = buscarYElo(nombreJugadora);
  if (yeloEntrada == null || eloSuperficie == null) return eloSuperficie;
  const nPartidos = (yeloEntrada.v || 0) + (yeloEntrada.d || 0);
  const { pesoYElo, pesoSuperficie } = pesoYEloPorPartidos(nPartidos);
  return yeloEntrada.yelo * pesoYElo + eloSuperficie * pesoSuperficie;
}

function pEloBloqueMatriz(entradaEloFav, entradaEloNf, superficie) {
  const ratingFav = eloParaSuperficie(entradaEloFav, superficie);
  const ratingNf = eloParaSuperficie(entradaEloNf, superficie);
  return probEloGana(ratingFav, ratingNf); // null si falta algun rating -> bloque se ignora y se renormaliza
}

function pDominanceRatioBloqueMatriz(statsFav, statsNf, fatigaFav, fatigaNf, superficie, especialidadFav, debilidadFav, especialidadNf, debilidadNf, oddsPre) {
  // CALIBRADO (2026-08-16, peticion expresa del usuario, "DR real" + "52 semanas"): si las dos
  // jugadoras tienen el DR real pegado (statsFav.dr/statsNf.dr, TennisAbstract, ventana de
  // ultimas 52 semanas -- la misma que prioriza el parser de esta app sobre career-splits, ver
  // parsearTennisAbstract), se usa DIRECTAMENTE via regresion logistica real -- Match Charting
  // Project, ventana movil de 52 semanas ANTES de cada partido (no todo el historial sin
  // filtrar, version anterior descartada por menos fiel a como se usa el dato real): n=2328
  // ATP / n=1219 WTA, DR "de temporada" (media de los OTROS partidos de esa jugadora en esa
  // ventana, NO del partido que se predice -- prospectivo, no tautologico) contra el resultado
  // real de un partido no visto: precision 63,3% ATP / 61,4% WTA (algo menor que la
  // calibracion sin filtrar por fecha, 65,5%/63,9% -- ventanas mas cortas dan una media de DR
  // mas ruidosa por jugadora, pero es la version fiel a "52 semanas" que de verdad se pega).
  // Formula: P(fav gana) = 1/(1+exp(-(a + b*ln(DR_fav/DR_nf)))), a/b especificos por circuito.
  // Requiere el DR agregado de VARIOS partidos de cada jugadora (no el de un unico cruce). Si
  // falta el DR real de alguna de las dos, cae a la reconstruccion via statCore/holdBase2 --
  // mismo patron que el resto de la app: dato ausente no se fuerza.
  if (statsFav.dr != null && statsNf.dr != null && statsFav.dr > 0 && statsNf.dr > 0) {
    const esATP = STATE.circuit === 'ATP';
    const a = esATP ? -0.0184 : 0.1387, b = esATP ? 2.5142 : 2.0684;
    const z = a + b * Math.log(statsFav.dr / statsNf.dr);
    return 1 / (1 + Math.exp(-z));
  }
  const holdFav = holdBase2({ stats: statsFav, fatigaPreVal: fatigaFav, esFav: true, preMatchOdds: oddsPre, superficie, especialidadJugador: especialidadFav, debilidadJugador: debilidadFav });
  const holdNf = holdBase2({ stats: statsNf, fatigaPreVal: fatigaNf, esFav: false, preMatchOdds: oddsPre, superficie, especialidadJugador: especialidadNf, debilidadJugador: debilidadNf });
  if (holdFav == null || holdNf == null) return null;
  return probGanaPartido(holdFav, holdNf);
}

function combinarHoldBreak(holdPropio, breakRival) {
  if (holdPropio == null) return null;
  if (breakRival == null) return holdPropio;
  return (holdPropio + (1 - breakRival)) / 2;
}

function logit(p) {
  if (p == null || p <= 0 || p >= 1) return null;
  return Math.log(p / (1 - p));
}

function invLogit(x) {
  return 1 / (1 + Math.exp(-x));
}

function combinarHoldBreakLogOdds(holdPropio, breakRival, circuit) {
  if (holdPropio == null) return null;
  if (breakRival == null) return holdPropio;
  const mediaCircuito = MEDIA_CIRCUITO_HOLD[circuit];
  if (mediaCircuito == null) return combinarHoldBreak(holdPropio, breakRival);
  const lHold = logit(holdPropio), lRestoRival = logit(1 - breakRival), lMedia = logit(mediaCircuito);
  if (lHold == null || lRestoRival == null || lMedia == null) return combinarHoldBreak(holdPropio, breakRival);
  return invLogit(lHold + lRestoRival - lMedia);
}

function pHoldBreakIndexBloqueMatriz(holdSet1Fav, holdSet1Nf, sofaSet1Fav, sofaSet1Nf, pesoSet1Fav, pesoSet1Nf, oddsPre, holdMercadoSet1) {
  const holdGranularFav = holdSet2({ baseHoldSet1: holdSet1Fav, sofaSet1: sofaSet1Fav, pesoSet1Sofa: pesoSet1Fav, preMatchOdds: oddsPre, holdMercadoSet1 });
  const holdGranularNf = holdSet2({ baseHoldSet1: holdSet1Nf, sofaSet1: sofaSet1Nf, pesoSet1Sofa: pesoSet1Nf, preMatchOdds: oddsPre, holdMercadoSet1 });
  if (holdGranularFav == null || holdGranularNf == null) return null;
  return probGanaPartido(holdGranularFav, holdGranularNf);
}

// ARREGLADO (2026-09-18, peticion expresa del usuario: "vamos a eliminar la introduccion de
// datos de aces y dobles faltas y su porcentaje se reparte entre todo el resto de
// estadisticas"). Ver el mismo comentario, mas largo, en app.html junto a esta funcion --
// aces/df fuera (dependian de un dato historico de SofaScore que ya no se usa), y sus
// coeficientes reescalados proporcionalmente entre BP salvados/convertidos y tiebreaks para
// conservar el mismo "peso total" que tenian los 5 factores originales. AVISO DE HONESTIDAD:
// reescalado razonado, NO una regresion logistica nueva con datos reales sin aces/df.
function pSofascoreMicroBloqueMatriz(statsFav, statsNf) {
  if (!statsFav || !statsNf) return null;
  const { bpSalvados: bpsFav, bpConvertidos: bpcFav, tbGanados: tbgFav, tbJugados: tbjFav } = statsFav;
  const { bpSalvados: bpsNf, bpConvertidos: bpcNf, tbGanados: tbgNf, tbJugados: tbjNf } = statsNf;
  const esATP = STATE.circuit === 'ATP';
  const hayBp = bpsFav != null && bpsNf != null && bpcFav != null && bpcNf != null;
  const bpSalvDiff = hayBp ? (bpsFav - bpsNf) : 0;
  const bpConvDiff = hayBp ? (bpcFav - bpcNf) : 0;
  const hayTb = tbgFav != null && tbjFav > 0 && tbgNf != null && tbjNf > 0;
  const tbDiff = hayTb ? (tbgFav / tbjFav) - (tbgNf / tbjNf) : 0;
  if (!hayBp && !hayTb) return null;
  const coef = esATP
    ? { a: 0.01709, bpSalv: 2.74320, bpConv: 2.30890, tb: 1.12378 }
    : { a: 0.04981, bpSalv: 1.01576, bpConv: 2.21105, tb: 0.67680 };
  const z = coef.a + coef.bpSalv*bpSalvDiff + coef.bpConv*bpConvDiff + coef.tb*tbDiff;
  return 1 / (1 + Math.exp(-z));
}

function pTennisRatioDominanceBloqueMatriz(statsFav, statsNf) {
  if (!statsFav || !statsNf) return null;
  if ((statsFav.trPartidosVentana||0) < MIN_PARTIDOS_TENNISRATIO) return null;
  if ((statsNf.trPartidosVentana||0) < MIN_PARTIDOS_TENNISRATIO) return null;
  const drFav = statsFav.trDominanceRatio, drNf = statsNf.trDominanceRatio;
  const prevFav = statsFav.trBreakpointsPrevail, prevNf = statsNf.trBreakpointsPrevail;
  if (drFav == null || drNf == null || drFav <= 0 || drNf <= 0) return null;
  if (prevFav == null || prevNf == null || prevFav <= 0 || prevNf <= 0) return null;
  const zDR = 2.0 * Math.log(drFav / drNf);
  const zPrev = 2.0 * Math.log(prevFav / prevNf);
  return 1 / (1 + Math.exp(-((zDR + zPrev) / 2)));
}

function pPressurePointsBloqueMatriz(statsFav, statsNf) {
  if (!statsFav || !statsNf) return null;
  if ((statsFav.trPartidosVentana||0) < MIN_PARTIDOS_TENNISRATIO) return null;
  if ((statsNf.trPartidosVentana||0) < MIN_PARTIDOS_TENNISRATIO) return null;
  const { ppServe: psFav, ppReturn: prFav } = statsFav;
  const { ppServe: psNf, ppReturn: prNf } = statsNf;
  if (psFav == null || psNf == null || prFav == null || prNf == null) return null;
  const z = 4.0 * (((psFav - psNf) + (prFav - prNf)) / 2);
  return 1 / (1 + Math.exp(-z));
}

function ajustarPorMatchEfficiency(pFinal, statsFav, statsNf) {
  if (pFinal == null) return pFinal;
  const meFav = statsFav && statsFav.trMatchEfficiency, meNf = statsNf && statsNf.trMatchEfficiency;
  const nFav = statsFav && statsFav.trPartidosVentana, nNf = statsNf && statsNf.trPartidosVentana;
  if (meFav == null || meNf == null || nFav == null || nNf == null) return pFinal;
  if (nFav < 15 || nNf < 15) return pFinal;
  const diffAcotada = Math.max(-1, Math.min(1, (meFav - meNf) / 2));
  return Math.max(0.0001, Math.min(0.9999, pFinal + diffAcotada * 0.03));
}

function tramoOddsPerformance(cuotaPropia) {
  for (const t of REFERENCIA_TRAMO_CUOTA) if (cuotaPropia <= t.max) return t;
  return null;
}

function ajustarPorOddsPerformance(pFinal, statsFav, statsNf, cuotaFavHoy, cuotaNfHoy) {
  if (pFinal == null) return pFinal;
  let ajusteTotal = 0, ajustesAplicados = 0;
  const evaluarLado = (stats, cuotaHoy, signo) => {
    if (!stats || !stats.trOddsPerformance || !cuotaHoy) return;
    const tramo = tramoOddsPerformance(cuotaHoy);
    if (!tramo) return;
    const bracket = stats.trOddsPerformance[tramo.max];
    if (!bracket || bracket.n == null || bracket.n < 8) return;
    const real = bracket.w / bracket.n;
    const diff = Math.max(-0.15, Math.min(0.15, real - tramo.ref));
    ajusteTotal += signo * (diff / 0.15) * 0.03;
    ajustesAplicados++;
  };
  evaluarLado(statsFav, cuotaFavHoy, +1);
  evaluarLado(statsNf, cuotaNfHoy, -1);
  if (ajustesAplicados === 0) return pFinal;
  return Math.max(0.0001, Math.min(0.9999, pFinal + ajusteTotal));
}

function pMercadoBet365BloqueMatriz(oddFavBet365, oddNfBet365) {
  if (!oddFavBet365 || !oddNfBet365) return null;
  return desvigarShin(oddFavBet365, oddNfBet365);
}

function calcularProbabilidadFinalPonderada({
  pElo, pDominanceRatio, pHoldBreakIndex, pSofascoreMicro, pTennisRatioDominance, pPressurePoints, pIACualitativa, pMercadoBet365,
} = {}) {
  const w = pesosMatrizPonderadaActuales();
  const entradas = [
    ['elo', pElo], ['dominanceRatio', pDominanceRatio], ['holdBreakIndex', pHoldBreakIndex],
    ['sofascoreMicro', pSofascoreMicro], ['tennisRatioDominance', pTennisRatioDominance],
    ['pressurePoints', pPressurePoints], ['iaCualitativa', pIACualitativa], ['mercadoBet365', pMercadoBet365],
  ];
  let pesoDisponible = 0, acumulado = 0;
  for (const [clave, valor] of entradas) {
    if (valor === null || valor === undefined || Number.isNaN(valor)) continue;
    const v = Math.max(0, Math.min(1, Number(valor)));
    pesoDisponible += w[clave];
    acumulado += w[clave] * v;
  }
  if (pesoDisponible <= 0) return null;
  const pFinal = acumulado / pesoDisponible;
  return Math.max(0.0001, Math.min(0.9999, pFinal));
}

function pesosMatrizPonderadaActuales() {
  const esSinMercado = STATE.level === 'CH' || STATE.level === 'W100' || STATE.level === 'W75';
  return esSinMercado ? PESOS_MATRIZ_PONDERADA_SIN_MERCADO : PESOS_MATRIZ_PONDERADA_CON_MERCADO;
}

function calcularEdge(cuotaJusta, cuotaB365, factorMargen = 1.05) {
  if (!cuotaJusta || cuotaJusta === 1 || !cuotaB365 || cuotaB365 <= 0) return { edge: 0, apostar: false };
  // ARREGLADO (2026-08-17, peticion expresa del usuario: "con 5% basta"): el limite pasa de
  // estricto (<) a inclusivo (<=) -- justo en el margen exacto (edge bruto = 5% con colchon
  // 1.05) ahora SI se acepta, antes se rechazaba por un empate exacto.
  if (cuotaB365 < cuotaJusta * factorMargen) return { edge: 0, apostar: false };
  const edge = Math.round((cuotaB365 / (cuotaJusta * factorMargen) - 1) * 10000) / 10000;
  return { edge, apostar: true };
}

function kellyCuarto(p, cuotaB365) {
  if (!p || !cuotaB365 || cuotaB365 <= 1) return 0;
  const b = cuotaB365 - 1;
  const f = (p * b - (1 - p)) / b;
  return Math.max(0, f) / 4; // Kelly 1/4, cambiado desde 1/2 por decision del usuario 2026-07-26 -- basado en cuota (b) y edge (p*b-(1-p)), como siempre
}

function pProtegida(p, factorMargen) {
  if (!p) return p;
  const m = (factorMargen && factorMargen > 0) ? factorMargen : 1;
  return p / m;
}

function redondearEurosApuesta(eurosCrudos) {
  if (!eurosCrudos || eurosCrudos <= 0) return 0;
  return Math.min(5, Math.max(1, Math.round(eurosCrudos)));
}

function stakeTier(edge, p, cuotaB365, factorMargen = 1.05) {
  if (edge <= 0) return null;
  if (p == null || cuotaB365 == null) return null; // sin datos suficientes para Kelly, no hay stake fiable
  const k = kellyCuarto(p, cuotaB365) * 100;
  const n = redondearEurosApuesta(k); // mismas bandas que el importe en euros
  return n ? ('St' + n) : null;
}

function stakeEuros(edge, bankrollUnidad, p, cuotaB365, factorMargen = 1.05) {
  if (edge <= 0) return 0;
  if (p == null || cuotaB365 == null) return 0; // sin datos suficientes para Kelly, no se apuesta
  const k = kellyCuarto(p, cuotaB365); // fraccion 0..1 de la banca -- p cruda, sin colchon (ver ARREGLADO arriba)
  const eurosCrudos = k * bankrollUnidad;
  return redondearEurosApuesta(eurosCrudos);
}

function desvigarProporcional(oddFav, oddNf) {
  const impFav = 1/oddFav, impNf = 1/oddNf;
  return impFav / (impFav + impNf);
}

function desvigarShin(oddFav, oddNf) {
  if (!oddFav || !oddNf || oddFav <= 1 || oddNf <= 1) return null;
  const piFav = 1/oddFav, piNf = 1/oddNf;
  const Spi = piFav + piNf;
  // p_i(z) segun la formula de Shin -- funcion auxiliar reutilizada en la busqueda.
  function pDeZ(pi_i, z) {
    if (z >= 1) return null;
    const dentro = z*z + 4*(1-z)*(pi_i*pi_i)/Spi;
    if (dentro < 0) return null;
    return (Math.sqrt(dentro) - z) / (2*(1-z));
  }
  // Biseccion sobre z en [0, 0.5): buscamos el z que hace que pFav(z)+pNf(z) = 1.00 exacto.
  // Con overround real (Spi>1) la suma proporcional simple (z=0) YA da mas de 1 (por eso
  // hace falta desvigar) -- a medida que z crece, la suma pFav(z)+pNf(z) decrece, así que
  // hay una unica raiz en ese intervalo (biseccion segura, sin necesitar derivadas).
  let zLo = 0, zHi = 0.5;
  for (let iter = 0; iter < 60; iter++) {
    const zMid = (zLo + zHi) / 2;
    const pFavMid = pDeZ(piFav, zMid), pNfMid = pDeZ(piNf, zMid);
    if (pFavMid == null || pNfMid == null) { zHi = zMid; continue; }
    const suma = pFavMid + pNfMid;
    if (suma > 1) zLo = zMid; else zHi = zMid;
  }
  const zFinal = (zLo + zHi) / 2;
  const pFav = pDeZ(piFav, zFinal), pNf = pDeZ(piNf, zFinal);
  if (pFav == null || pNf == null) return desvigarProporcional(oddFav, oddNf); // red de seguridad: si algo sale mal, cae al metodo simple en vez de devolver null
  // Normalizacion final por si la biseccion deja un residuo de redondeo minimo.
  return pFav / (pFav + pNf);
}

function techoHold(){ return STATE.circuit === 'ATP' ? 0.93 : 0.9; }
const MEDIA_CIRCUITO_HOLD = { ATP: 0.65, WTA: 0.60 };

const MIN_PARTIDOS_TENNISRATIO = 3;

const REFERENCIA_TRAMO_CUOTA = [
  { max: 1.20, ref: 0.88 },
  { max: 1.50, ref: 0.75 },
  { max: Infinity, ref: 0.55 },
];

function holdSet2({ baseHoldSet1 /* N2 o O2 */, sofaSet1, pesoSet1Sofa, preMatchOdds, holdMercadoSet1 /* S3 o T3 */,
                    minutosSet1, ifsPropio }) {
  let val;
  const haySofa = sofaSet1 !== null && sofaSet1 !== undefined;
  const hayPreMatch = preMatchOdds && preMatchOdds.n3 && preMatchOdds.p3;
  if (!hayPreMatch) {
    val = !haySofa ? baseHoldSet1 : (1 - pesoSet1Sofa) * baseHoldSet1 + pesoSet1Sofa * sofaSet1;
  } else {
    if (!haySofa) {
      val = (1 - pesoSet1Sofa) * baseHoldSet1 + pesoSet1Sofa * holdMercadoSet1;
    } else {
      val = (1 - pesoSet1Sofa - 0.075) * baseHoldSet1 + pesoSet1Sofa * sofaSet1 + 0.075 * holdMercadoSet1;
    }
  }
  // Invertido: "(ifsPropio-0.7)" daba MAS penalizacion a jugadoras FUERTES y, para ifs<0.7,
  // llegaba a dar una BONIFICACION a las mas debiles (valor negativo restado = suma). Con
  // "(1.3-ifsPropio)" se preserva el mismo valor exacto en ifs=1.0 (el punto ya calibrado)
  // pero ahora sube correctamente para jugadoras mas debiles, sin poder volverse negativo
  // dentro del rango real de ifs (0.36-1.5 aprox).
  // CORREGIDO DE VERDAD (2026-07-25): comprobado empiricamente que ni la formula original
  // (ifsPropio-0.7) ni el "arreglo" anterior (1.3-ifsPropio) daban mas penalizacion a la
  // debil -- las dos, probadas con datos reales, davan MENOS penalizacion a ifs alto (debil).
  // ifsPropio*0.3 preserva el mismo valor en el punto ya calibrado (ifs=1.0 -> 0.3) y ahora
  // SI da mas penalizacion cuanto mas alto (mas debil) es ifs, verificado con Sabalenka(0.78)
  // vs Muchova(1.15): antes debil=mas hold (mal), ahora debil=menos hold (correcto).
  const fatiga = (minutosSet1 === null || minutosSet1 === undefined) ? 0 : Math.max(0, (minutosSet1 - 60) / 150) * (ifsPropio ?? 1) * 0.3;
  return Math.max(0.36, Math.min(techoHold(), val - fatiga));
}

function probGanaPartido(holdFav, holdNf, nSim) {
  nSim = nSim || 4000;
  // Semilla determinista a partir de los datos de entrada (redondeados a 6 decimales, para que
  // valores que se ven iguales en pantalla den la misma semilla) + nSim -- mismos datos de
  // entrada, siempre la misma secuencia de numeros aleatorios, siempre el mismo resultado.
  const semillaBase = Math.round(holdFav*1e6)*2654435761 + Math.round(holdNf*1e6)*40503 + nSim;
  _prngSimulacion = _crearPRNG(semillaBase);
  let ganaFav = 0;
  for (let i=0; i<nSim; i++) {
    let setsFav=0, setsNf=0, sirveFav=true;
    let guardSets = 0;
    while (setsFav<2 && setsNf<2 && guardSets++<10) {
      const ganoFav = simularSetParaPartido(holdFav, holdNf, sirveFav);
      if (ganoFav) setsFav++; else setsNf++;
      sirveFav = !sirveFav;
    }
    if (setsFav===2) ganaFav++;
  }
  return ganaFav/nSim;
}

function _crearPRNG(semilla){
  let s = semilla >>> 0;
  return function(){
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simularSetParaPartido(holdA, holdB, sirveA) {
  let gA = 0, gB = 0, turno = sirveA ? 0 : 1;
  let guard = 0;
  while (guard++ < 200) {
    if ((gA>=6||gB>=6) && Math.abs(gA-gB)>=2) return gA > gB;
    if (gA===6 && gB===6) return _prngSimulacion() < 0.5;
    const hold = turno===0 ? holdA : holdB;
    const ganaSaque = _prngSimulacion() < hold;
    if (turno===0) { if (ganaSaque) gA++; else gB++; }
    else { if (ganaSaque) gB++; else gA++; }
    turno = 1-turno;
  }
  return gA > gB;
}

function holdBase2({ stats, fatigaPreVal, esFav, preMatchOdds, preSet2Odds, preSet3Odds, enSet2, enSet3, superficie, especialidadJugador, debilidadJugador }) {
  const nucleo = statCore(stats, fatigaPreVal);
  const base36 = Math.max(0.36, Math.min(techoHold(), nucleo));
  const bonus = bonusEspecialidadSuperficie(superficie, especialidadJugador) + penalDebilidadSuperficie(superficie, debilidadJugador);
  const hayPreMatch = preMatchOdds && preMatchOdds.n3 && preMatchOdds.p3;
  if (!hayPreMatch) return Math.max(0.36, Math.min(techoHold(), base36 + bonus));

  let holdMercado;
  if (enSet3 && preSet3Odds && preSet3Odds.n5) {
    const ratio = esFav ? ratioImplicitoFav(preSet3Odds.n5, preSet3Odds.p5) : ratioImplicitoNf(preSet3Odds.n5, preSet3Odds.p5);
    holdMercado = holdDesdeRatio(ratio);
  } else if (enSet2 && preSet2Odds && preSet2Odds.n4) {
    const ratio = esFav ? ratioImplicitoFav(preSet2Odds.n4, preSet2Odds.p4) : ratioImplicitoNf(preSet2Odds.n4, preSet2Odds.p4);
    holdMercado = holdDesdeRatio(ratio);
  } else {
    const ratio = esFav ? ratioImplicitoFav(preMatchOdds.n3, preMatchOdds.p3) : ratioImplicitoNf(preMatchOdds.n3, preMatchOdds.p3);
    holdMercado = holdDesdeRatio(ratio);
  }
  const val = 0.925 * base36 + 0.075 * holdMercado + bonus;
  return Math.max(0.36, Math.min(techoHold(), val));
}

function statCore({ pct1in, pct1won, pct2in, pct2won, bpConvertidos, bpSalvados, aces, df }, fatigaPreVal) {
  const b6 = pct1in ?? 0.62;
  const esATP = STATE.circuit === 'ATP';
  // La fatiga ahora se aplica DIRECTAMENTE sobre el % de puntos ganados con 1er y 2º saque
  // (lo que teoricamente afecta el cansancio en una jugadora WTA: consistencia de saque, no
  // "potencia" general) en vez de sumarse como un termino generico al final del calculo.
  // CALIBRADO (2026-07-26 WTA / 2026-08-15 ATP) con la media real de cada circuito --
  // Match Charting Project (github.com/JeffSackmann/tennis_MatchChartingProject, partidos
  // hasta ago-2026): WTA n=8140 partidos, 1er saque ganado 65% (redondeado, recalculo exacto
  // 63,82%); ATP n=15115 partidos, 1er saque ganado 72,03% -- el saque domina bastante mas en
  // el circuito masculino, confirmado con datos reales, no solo por conocimiento general.
  const b7 = Math.max(0.2, (pct1won ?? (esATP ? 0.7203 : 0.65)) + fatigaPreVal);
  const b8 = pct2in ?? 0.95;
  // CALIBRADO: WTA 2º saque ganado 45,5% (n=39116, Sackmann 2018-2025, calibrado 2026-07-26).
  // ATP 2º saque ganado 51,04% (n=15115, Match Charting Project, calibrado 2026-08-15).
  const b9 = Math.max(0.2, (pct2won ?? (esATP ? 0.5104 : 0.455)) + fatigaPreVal);
  // CALIBRADO: WTA bpConvertidos 47,7% / bpSalvados 51,2% (2026-07-26). ATP bpConvertidos
  // 38,90% / bpSalvados 61,10% (2026-08-15, Match Charting Project, n=15115) -- en ATP se
  // salvan muchos mas quiebres por el saque mas dominante. Estos numeros son tambien el punto
  // NEUTRO del bonus/penalizacion de mas abajo (val = ... + (b11-bpConvBase)*0.15 + ...) --
  // por eso hacia falta el numero especifico de ATP y no solo el de respaldo cuando falta el
  // dato: usar la media de WTA aqui penalizaria de mas a CUALQUIER jugador ATP normal, tenga
  // o no dato real metido (ver conversacion completa sobre este punto).
  const bpConvBase = esATP ? 0.3890 : 0.477, bpSalvBase = esATP ? 0.6110 : 0.512;
  const acesBase = esATP ? 6.95 : 2.5;
  const b11 = bpConvertidos ?? bpConvBase, b10 = bpSalvados ?? bpSalvBase, b13 = aces ?? acesBase;
  // ESTIMACION (2026-07-25), aplicada igual que en Nuevosistema1.html: las dobles faltas se
  // solapan mucho con pct2in matematicamente, asi que solo se penaliza el exceso sobre un
  // umbral (4/partido), con magnitud pequeña, para no contar el mismo problema dos veces.
  const penalDf = (df != null && df > 4) ? Math.min(0.02, (df - 4) * 0.003) : 0;
  const val = b6*b7 + (1-b6)*b8*b9 + (b11-bpConvBase)*0.15 + (b10-bpSalvBase)*0.15 + (b13-acesBase)/100*b6 - penalDf;
  const puntoProb = Math.max(0.42, Math.min(0.9, val));
  return Math.max(0.36, Math.min(techoHold(), probHoldExacto(puntoProb)));
}

function bonusEspecialidadSuperficie(superficiePartido, especialidadJugador) {
  if (!superficiePartido || !especialidadJugador) return 0;
  return superficiePartido === especialidadJugador ? 0.02 : 0;
}

function penalDebilidadSuperficie(superficiePartido, debilidadJugador) {
  if (!superficiePartido || !debilidadJugador) return 0;
  return superficiePartido === debilidadJugador ? -0.03 : 0;
}

function ratioImplicitoFav(nOdd, pOdd) {
  if (!nOdd || !pOdd) return null;
  return Math.round(((1/nOdd) / ((1/nOdd) + (1/pOdd))) * 1000) / 1000;
}

function ratioImplicitoNf(nOdd, pOdd) {
  if (!nOdd || !pOdd) return null;
  return Math.round(((1/pOdd) / ((1/nOdd) + (1/pOdd))) * 1000) / 1000;
}

function holdDesdeRatio(ratioSinRedondear) {
  if (ratioSinRedondear === null || ratioSinRedondear === undefined) return null;
  return Math.round(Math.max(0.36, Math.min(0.9, 0.475 + ratioSinRedondear * 0.376)) * 1000) / 1000;
}

function ratioImplicitoFavRedondeado(nOdd, pOdd) {
  const r = ratioImplicitoFav(nOdd, pOdd);
  return r === null ? null : Math.round(r * 1000) / 1000;
}

function probHoldExacto(p) {
  const memo = {};
  function rec(pa, pb) {
    const key = pa + '_' + pb;
    if (memo[key] !== undefined) return memo[key];
    if (pa >= 4 && pa - pb >= 2) return memo[key] = 1.0;
    if (pb >= 4 && pb - pa >= 2) return memo[key] = 0.0;
    if (pa >= 3 && pb >= 3 && pa === pb) return memo[key] = (p*p) / (p*p + (1-p)*(1-p));
    return memo[key] = p*rec(pa+1, pb) + (1-p)*rec(pa, pb+1);
  }
  return rec(0, 0);
}
// ---------------------------------------------------------------------------
// Ajuste por fuerza del rival + mezcla oficial/reciente -- portado literal de
// app.html (esperadoRestoSegunRanking, ajustarPorFuerzaRival, PESO_RECIENTE_TOTAL,
// mezclarOficialRecienteGlobal), usado para reconstruir la "forma reciente" real
// a partir del Match History de TennisRatio (mismo dato que pega el usuario a mano).
// ---------------------------------------------------------------------------
// CORREGIDO (2026-09-22, mismo cambio que app.html, ver ese archivo para el razonamiento
// completo con datos reales): la pendiente 0,0213 no reproducia la propia calibracion
// documentada de origen (10.364 partidos WTA 2023-24: 8,2pp de diferencia real entre rank 20 y
// rank 200 => pendiente correcta 0,0356, no 0,0213). Se separa ademas en RESTO (breakPct/
// bpConvertidos/pct1won/pct2won) y SAQUE (holdPct/bpSalvados/bpSaved), con pendiente propia para
// cada una, validada con 9.759 partidos reales de TennisRatio (12 jugadores, efectos fijos por
// jugador): hold=0,0523, break=0,0772.
// PENDIENTE ASIMETRICA (2026-09-22, mismo cambio que app.html): repitiendo la regresion de
// efectos fijos partiendo cada jugador en zona "rival de hoy mas fuerte que su mediana de rivales"
// (underdog) vs "mas debil" (favorito), la pendiente NO es constante -- mas plana en underdog, mas
// pronunciada en favorito, t muy significativo en las 4 (t=6.24 a t=11.42, n>=2429 por zona):
//   hold:  underdog b=0,0381 (n=2450) | favorito b=0,0704 (n=2430) | pool b=0,0523
//   break: underdog b=0,0509 (n=2450) | favorito b=0,1026 (n=2429) | pool b=0,0772
// Saque usa estas pendientes directamente (misma fuente que ya daba el 0,0523 pool). Resto sigue
// anclado en magnitud a la fuente mas amplia (10.364 partidos, 0,0356) pero se le aplica la misma
// proporcion underdog/pool y favorito/pool medida en esta regresion (0,6592 y 1,3290) en vez de
// sustituir el 0,0356 por el pool de esta muestra mas pequeña (0,0772).
const PEND_RESTO_UNDERDOG = 0.0235;   // 0,0356 * (0,0509/0,0772)
const PEND_RESTO_FAVORITO = 0.0473;   // 0,0356 * (0,1026/0,0772)
const PEND_SAQUE_UNDERDOG = 0.0381;
const PEND_SAQUE_FAVORITO = 0.0704;
function ajustarPorFuerzaRivalResto(pctObservado, rankRivalesRecientes, rankRivalHoy) {
  if (pctObservado == null || rankRivalesRecientes == null || rankRivalHoy == null) return pctObservado;
  const pendiente = (rankRivalHoy <= rankRivalesRecientes) ? PEND_RESTO_UNDERDOG : PEND_RESTO_FAVORITO;
  const ajuste = pendiente * (Math.log(Math.max(1, rankRivalHoy)) - Math.log(Math.max(1, rankRivalesRecientes)));
  return Math.max(0.05, Math.min(0.95, pctObservado + ajuste));
}
function ajustarPorFuerzaRivalSaque(pctObservado, rankRivalesRecientes, rankRivalHoy) {
  if (pctObservado == null || rankRivalesRecientes == null || rankRivalHoy == null) return pctObservado;
  const pendiente = (rankRivalHoy <= rankRivalesRecientes) ? PEND_SAQUE_UNDERDOG : PEND_SAQUE_FAVORITO;
  const ajuste = pendiente * (Math.log(Math.max(1, rankRivalHoy)) - Math.log(Math.max(1, rankRivalesRecientes)));
  return Math.max(0.05, Math.min(0.95, pctObservado + ajuste));
}
// Alias retrocompatible (RESTO, uso original antes de separar saque).
function ajustarPorFuerzaRival(pctObservado, rankRivalesRecientes, rankRivalHoy) {
  return ajustarPorFuerzaRivalResto(pctObservado, rankRivalesRecientes, rankRivalHoy);
}
const PESO_RECIENTE_TOTAL = 0.25;
// mezclarOficialRecienteGlobal: CAMBIADO (2026-09-22, mismo cambio que app.html -- ver ese
// archivo para el razonamiento completo con el caso real De Jong/Guerrieri, 11-12 partidos de
// TennisAbstract vs 25-88 de TennisRatio en la misma ventana). Ahora pondera por muestra real en
// vez de un reparto fijo 75/12,5/12,5; cae al reparto fijo solo si no se pasa ningun numero de
// partidos (compatibilidad con llamadas antiguas).
const N_TOPE_MUESTRA = 40;
const RELEVANCIA_GLOBAL = 0.35;
const N_OFICIAL_SIN_DATO = 15;
function mezclarOficialRecienteGlobal(oficial, recienteSuperficie, recienteGlobal, nOficial, nRecienteSuperficie, nRecienteGlobal) {
  const sinNumerosDeMuestra = nOficial == null && nRecienteSuperficie == null && nRecienteGlobal == null;
  if (sinNumerosDeMuestra) {
    if (oficial == null) return recienteSuperficie != null ? recienteSuperficie : recienteGlobal;
    if (recienteSuperficie != null && recienteGlobal != null) {
      return (1 - PESO_RECIENTE_TOTAL) * oficial + (PESO_RECIENTE_TOTAL / 2) * recienteSuperficie + (PESO_RECIENTE_TOTAL / 2) * recienteGlobal;
    }
    const recienteDisponible = recienteSuperficie != null ? recienteSuperficie : recienteGlobal;
    if (recienteDisponible == null) return oficial;
    return (1 - PESO_RECIENTE_TOTAL) * oficial + PESO_RECIENTE_TOTAL * recienteDisponible;
  }
  const capado = n => n == null ? 0 : Math.min(Math.max(0, n), N_TOPE_MUESTRA);
  const partes = [];
  if (oficial != null) partes.push([oficial, Math.max(capado(nOficial), N_OFICIAL_SIN_DATO)]);
  if (recienteSuperficie != null) partes.push([recienteSuperficie, capado(nRecienteSuperficie)]);
  if (recienteGlobal != null) partes.push([recienteGlobal, capado(nRecienteGlobal) * RELEVANCIA_GLOBAL]);
  if (!partes.length) return null;
  const pesoTotal = partes.reduce((acc, [, p]) => acc + p, 0);
  if (pesoTotal <= 0) return partes[0][0];
  return partes.reduce((acc, [v, p]) => acc + v * p, 0) / pesoTotal;
}
const VIDA_MEDIA_DIAS_TA = 60;
// calcularFormaHistoricaTennisRatio: portado literal de app.html. partidos[] debe traer los
// MISMOS campos que el parser de la pagina "Match History" produce (fecha, rankRival, aces,
// df, bpSalvados, bpFaced, holdGames, holdGamesTotal, bpConvertidos, bpCreados, breakGames,
// breakGamesTotal) -- confirmado campo a campo identicos a los que ya trae matchesData de la
// ficha de jugador/a (misma fuente de datos que la pagina Match History, solo que en JSON
// servido por el servidor en vez de HTML a parsear).
function calcularFormaHistoricaTennisRatio(partidos, fechaReferencia, rankRivalHoy) {
  if (!partidos || !partidos.length) return null;
  const campos = ['aces', 'df', 'bpSalvados', 'bpConvertidos', 'trDominanceRatio', 'trBreakpointsPrevail', 'holdPct', 'breakPct'];
  const sumaPeso = {}, sumaValor = {};
  campos.forEach(c => { sumaPeso[c] = 0; sumaValor[c] = 0; });
  let pesoEfectivo = 0, nPartidosUsados = 0;
  for (const p of partidos) {
    if (!(p.fecha instanceof Date) || isNaN(p.fecha.getTime())) continue;
    // GUARDA (2026-09-17, fallo real critico detectado): un partido de HOY MISMO (o posterior)
    // que ya aparece cerrado en la fuente en el momento de scrapear no puede entrar en la
    // "forma reciente" -- si se colara, diasAgo saldria 0, el PESO MAXIMO posible, contaminando
    // la prediccion con el resultado real del propio partido que se esta intentando predecir.
    if (p.fecha.getTime() >= fechaReferencia.getTime()) continue;
    nPartidosUsados++;
    const diasAgo = Math.max(0, (fechaReferencia - p.fecha) / 86400000);
    const peso = Math.exp(-diasAgo / VIDA_MEDIA_DIAS_TA);
    pesoEfectivo += peso;
    let bpSalvPct = (p.bpFaced > 0) ? p.bpSalvados / p.bpFaced : null;
    let bpConvPct = (p.bpCreados > 0) ? p.bpConvertidos / p.bpCreados : null;
    let holdPct = (p.holdGamesTotal > 0) ? p.holdGames / p.holdGamesTotal : null;
    let breakPct = (p.breakGamesTotal > 0) ? p.breakGames / p.breakGamesTotal : null;
    if (rankRivalHoy != null && p.rankRival != null) {
      if (bpSalvPct != null) bpSalvPct = ajustarPorFuerzaRivalSaque(bpSalvPct, p.rankRival, rankRivalHoy);
      if (bpConvPct != null) bpConvPct = ajustarPorFuerzaRivalResto(bpConvPct, p.rankRival, rankRivalHoy);
      if (holdPct != null) holdPct = ajustarPorFuerzaRivalSaque(holdPct, p.rankRival, rankRivalHoy);
      if (breakPct != null) breakPct = ajustarPorFuerzaRivalResto(breakPct, p.rankRival, rankRivalHoy);
    }
    const drPartido = (p.bpFaced > 0) ? (p.bpCreados / p.bpFaced) : null;
    const bpPerdidosServicio = (p.bpFaced != null && p.bpSalvados != null) ? (p.bpFaced - p.bpSalvados) : null;
    const prevailPartido = (bpPerdidosServicio > 0) ? (p.bpConvertidos / bpPerdidosServicio) : null;
    const valores = { aces: p.aces, df: p.df, bpSalvados: bpSalvPct, bpConvertidos: bpConvPct, trDominanceRatio: drPartido, trBreakpointsPrevail: prevailPartido, holdPct, breakPct };
    for (const c of campos) { if (valores[c] != null) { sumaPeso[c] += peso; sumaValor[c] += peso * valores[c]; } }
  }
  if (!nPartidosUsados) return null;
  const resultado = { nPartidos: nPartidosUsados, pesoEfectivo };
  for (const c of campos) resultado[c] = sumaPeso[c] > 0 ? sumaValor[c] / sumaPeso[c] : null;
  return resultado;
}

// calcularFormaHistoricaTA_DR: version de calcularFormaHistoricaTA (app.html linea ~4988)
// ACOTADA A DR -- es el UNICO campo que necesita el scraper de esa funcion (pct1in/pct1won/
// pct2won/bpSaved alimentan otro camino -- el fallback de holdBase2 cuando falta el DR de TA,
// que no aplica aqui porque el DR SI esta presente). Mismas reglas EXACTAS que la app para DR
// en concreto: filtro por superficie de hoy con minimo 5 partidos (si no llega, null -- no se
// fuerza media con poca muestra), ponderacion por fecha con vida media 60 dias, y SIN ajuste
// por fuerza del rival (la app deja el DR sin ajustar a proposito: "no es un porcentaje, sumarle
// un ajuste pensado en puntos porcentuales no tiene sentido matematico sin una conversion propia
// calibrada, que no existe todavia").
// CAMBIADO (2026-09-22): devuelve {dr, n} en vez de solo el numero, para poder pasar el tamano
// real de muestra a mezclarOficialRecienteGlobal (precision-weighting, ver esa funcion). Los
// llamadores existentes que solo quieran el valor deben leer .dr del resultado.
function calcularFormaHistoricaTA_DR(filas, fechaReferencia, superficieHoy) {
  const conDR = (filas || []).filter(f => f.dr != null && f.fecha instanceof Date && !isNaN(f.fecha.getTime()));
  if (!conDR.length) return null;
  const MIN_PARTIDOS_MISMA_SUPERFICIE = 5;
  const filas2 = superficieHoy ? conDR.filter(f => f.superficie === superficieHoy) : conDR;
  if (superficieHoy && filas2.length < MIN_PARTIDOS_MISMA_SUPERFICIE) return null;
  if (!filas2.length) return null;
  let sumaPeso = 0, sumaValor = 0, n = 0;
  for (const f of filas2) {
    // GUARDA (2026-09-17, mismo fallo critico que calcularFormaHistoricaTennisRatio): descarta
    // filas de hoy/futuro para no dejar que el resultado real del propio partido a predecir
    // entre en su propia forma reciente con el peso maximo posible.
    if (f.fecha.getTime() >= fechaReferencia.getTime()) continue;
    const diasAgo = Math.max(0, (fechaReferencia - f.fecha) / 86400000);
    const peso = Math.exp(-diasAgo / VIDA_MEDIA_DIAS_TA);
    sumaPeso += peso; sumaValor += peso * f.dr; n++;
  }
  if (sumaPeso <= 0) return null;
  return { dr: sumaValor / sumaPeso, n };
}

module.exports = {
  STATE, setCircuito, setNivel, cargarTablasElo,
  ajustarPorFuerzaRival, ajustarPorFuerzaRivalResto, ajustarPorFuerzaRivalSaque,
  mezclarOficialRecienteGlobal, calcularFormaHistoricaTennisRatio,
  calcularFormaHistoricaTA_DR,
  buscarElo, eloParaSuperficie, probEloGana, buscarYElo, pesoYEloPorPartidos, calcularYEloPonderado,
  pEloBloqueMatriz, pDominanceRatioBloqueMatriz, combinarHoldBreak, logit, invLogit, combinarHoldBreakLogOdds,
  pHoldBreakIndexBloqueMatriz, pSofascoreMicroBloqueMatriz, pTennisRatioDominanceBloqueMatriz, pPressurePointsBloqueMatriz,
  ajustarPorMatchEfficiency, tramoOddsPerformance, ajustarPorOddsPerformance, pMercadoBet365BloqueMatriz,
  calcularProbabilidadFinalPonderada, pesosMatrizPonderadaActuales, calcularEdge, kellyCuarto, pProtegida,
  redondearEurosApuesta, stakeTier, stakeEuros, desvigarProporcional, desvigarShin, techoHold,
  holdSet2, probGanaPartido, holdBase2, statCore, bonusEspecialidadSuperficie, penalDebilidadSuperficie,
  ratioImplicitoFav, ratioImplicitoNf, holdDesdeRatio, ratioImplicitoFavRedondeado, probHoldExacto,
  PESOS_MATRIZ_PONDERADA_CON_MERCADO, PESOS_MATRIZ_PONDERADA_SIN_MERCADO, MEDIA_CIRCUITO_HOLD,
  MIN_PARTIDOS_TENNISRATIO, REFERENCIA_TRAMO_CUOTA,
};
