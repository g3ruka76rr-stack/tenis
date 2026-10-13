'use strict';
// ============================================================================
// scrapers/tennisabstract.js
// ----------------------------------------------------------------------------
// TennisAbstract sirve TODO server-renderizado (confirmado 2026-09-17): las
// tablas de Elo/yElo (wta_elo_ratings.html, atp_elo_ratings.html,
// wta_season_yelo_ratings.html, atp_season_yelo_ratings.html) son HTML plano,
// y la ficha de cada jugador/a se sirve como un fragmento de HTML embebido
// dentro de un string JS en https://www.tennisabstract.com/jsfrags/<Nombre>.js
// (el mismo dato que la pagina jugador.cgi pinta con jQuery en el navegador).
// No hace falta Puppeteer para nada de esto -- solo peticiones HTTP directas.
// ============================================================================
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' al pedir ' + url);
  return res.text();
}

// slugNombre: convierte "Iga Świątek" -> "IgaSwiatek", igual que la convencion de
// nombres de archivo que usa tennisabstract.com/jsfrags/. Quita acentos, espacios,
// guiones y apostrofes.
function slugNombre(nombreCompleto) {
  return nombreCompleto
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z]/g, '');
}

// ---------------------------------------------------------------------------
// Elo / yElo -- reutiliza los MISMOS parsers ya escritos para el panel de
// pegado de la app (parsearTablaEloTennisAbstract / parsearTablaYEloTennisAbstract),
// pero aqui se les da el TEXTO PLANO extraido con cheerio del HTML real de la
// pagina (equivalente exacto a lo que el usuario pegaria a mano), no HTML crudo.
// ---------------------------------------------------------------------------
const { parsearTablaEloTennisAbstract, parsearTablaYEloTennisAbstract } = require('./elo_parsers.js');

function textoPlanoDeTabla($, selectorTabla) {
  // Reconstruye, fila a fila, el mismo texto tabulado que produce un
  // copy/paste real de la tabla desde el navegador (una fila por linea,
  // celdas separadas por tabulador) -- asi los parsers ya validados contra
  // el pegado manual funcionan sin cambios.
  const lineas = [];
  $(selectorTabla).find('tr').each((_, tr) => {
    const celdas = [];
    $(tr).find('td,th').each((__, td) => {
      celdas.push($(td).text().replace(/\s+/g, ' ').trim());
    });
    if (celdas.length) lineas.push(celdas.join('\t'));
  });
  return lineas.join('\n');
}

async function descargarEloRatings(circuito /* 'WTA'|'ATP' */) {
  const url = circuito === 'ATP'
    ? 'https://www.tennisabstract.com/reports/atp_elo_ratings.html'
    : 'https://www.tennisabstract.com/reports/wta_elo_ratings.html';
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  // La tabla de ratings es la primera <table> grande de la pagina con cabecera "Elo".
  let texto = '';
  $('table').each((_, t) => {
    const cab = $(t).find('tr').first().text();
    if (/Elo/i.test(cab) && /Player/i.test(cab)) texto = textoPlanoDeTabla($, t);
  });
  if (!texto) throw new Error('No se encontro la tabla de Elo en ' + url);
  const claveRank = circuito === 'ATP' ? 'atpRank' : 'wtaRank';
  return parsearTablaEloTennisAbstract(texto, claveRank);
}

async function descargarYEloRatings(circuito) {
  const url = circuito === 'ATP'
    ? 'https://www.tennisabstract.com/reports/atp_season_yelo_ratings.html'
    : 'https://www.tennisabstract.com/reports/wta_season_yelo_ratings.html';
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  let texto = '';
  $('table').each((_, t) => {
    const cab = $(t).find('tr').first().text();
    if (/yElo/i.test(cab) && /Player/i.test(cab)) texto = textoPlanoDeTabla($, t);
  });
  if (!texto) throw new Error('No se encontro la tabla de yElo en ' + url);
  const claveRank = circuito === 'ATP' ? 'atpRankYElo' : 'wtaRankYElo';
  return parsearTablaYEloTennisAbstract(texto, claveRank);
}

// ---------------------------------------------------------------------------
// Ficha de jugador/a: Hold%/Break%/DR por superficie, ventana "Last 52 Weeks"
// (prioridad, igual que parsearTennisAbstract en la app) con fallback a
// "Career". Tambien MS (partidos con stats) para partidosSuperficie.
// ---------------------------------------------------------------------------
const SUPERFICIE_TABLA = { D: 'Hard', T: 'Clay', H: 'Grass' };

async function descargarSplitsJugador(nombreCompleto, superficie) {
  const slug = slugNombre(nombreCompleto);
  const url = 'https://www.tennisabstract.com/jsfrags/' + slug + '.js';
  let js;
  try {
    js = await fetchText(url);
  } catch (e) {
    return { error: 'no_encontrado', detalle: e.message, url };
  }
  // player_frag es un string JS (con comillas escapadas) que contiene el HTML de
  // toda la ficha. Se evalua en un sandbox minimo (solo asignaciones de variables,
  // sin acceso a nada del proceso) para obtener el string ya des-escapado, en vez
  // de reimplementar un unescaper de JS a mano.
  const sandbox = {};
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', js + '\nthis.__frag = typeof player_frag !== "undefined" ? player_frag : null;')
      .call(sandbox, {}, {});
  } catch (e) {
    return { error: 'parse_js_fallo', detalle: e.message, url };
  }
  const fragHtml = sandbox.__frag;
  if (!fragHtml) return { error: 'sin_player_frag', url };

  const $ = cheerio.load(fragHtml);
  const surfaceWord = SUPERFICIE_TABLA[superficie];

  function extraerDeTabla(idTabla) {
    if ($('#' + idTabla).length === 0) return null;
    let fila = null;
    $('#' + idTabla).find('tbody tr').each((_, tr) => {
      const primera = $(tr).find('td').first().text().trim();
      if (primera === surfaceWord) fila = tr;
    });
    if (!fila) return null;
    const celdas = $(fila).find('td').map((_, td) => $(td).text().trim()).get();
    // Cabecera real (confirmada 2026-09-17): Split, M, W-L, Hld%, Brk-Hld(TB W-L), TB%, MS,
    // Hld%, Brk%, A%, DF%, 1stIn, 1st%, 2nd%, SPW, RPW, TPW, DR, Best.
    // Se localizan las columnas por CABECERA real, no por indice fijo, para no romperse si
    // tennisabstract cambia una columna intermedia.
    const cab = $('#' + idTabla).find('thead th').map((_, th) => $(th).text().trim()).get();
    const idx = (nombreCol) => cab.findIndex(c => c.toLowerCase() === nombreCol.toLowerCase());
    const iMS = idx('MS'), iHld = idx('Hld%'), iBrk = idx('Brk%'), iDR = idx('DR');
    const num = (s) => { if (s == null) return null; const v = parseFloat(String(s).replace('%', '')); return isNaN(v) ? null : v; };
    return {
      partidosSuperficie: iMS >= 0 ? num(celdas[iMS]) : null,
      holdPct: iHld >= 0 ? (num(celdas[iHld]) != null ? num(celdas[iHld]) / 100 : null) : null,
      breakPct: iBrk >= 0 ? (num(celdas[iBrk]) != null ? num(celdas[iBrk]) / 100 : null) : null,
      dr: iDR >= 0 ? num(celdas[iDR]) : null,
    };
  }

  // Jugadoras/es mas centrados en circuito ITF/Challenger tienen sus splits en tablas con id
  // "-chall" (last52-splits-chall / career-splits-chall) en vez de las de gira principal --
  // MISMAS columnas, solo cambia el id (confirmado 2026-09-17 con Alicia Herrero Liñana:
  // Clay Hld% 61.1 / Brk% 45.9 / DR 1.06 / MS 46, coincide exacto con lo que da tennisabstract
  // a mano). Se prueban ambas variantes, torneo principal primero.
  const last52 = extraerDeTabla('last52-splits') || extraerDeTabla('last52-splits-chall');
  const career = extraerDeTabla('career-splits') || extraerDeTabla('career-splits-chall');
  const resultado = last52 || career || {};

  // Tabla "recent-results": partido a partido, ya trae el DR de CADA partido en columna propia
  // (confirmado 2026-09-17: headers reales Date/Tournament/Surface/Rd/Rk/vRk/[desc]/Score/DR/
  // A%/DF%/1stIn/1st%/2nd%/BPSvd/Time) -- se usa para reconstruir la forma reciente REAL del DR
  // (calcularFormaHistoricaTA en la app), ponderada por fecha. Se localizan las columnas por
  // cabecera, no por indice fijo, salvo la de descripcion que no tiene texto de cabecera propio
  // (es la que cae justo despues de vRk) -- no se necesita aqui, solo para DR.
  const resultadosRecientes = [];
  const cabRR = $('#recent-results').find('thead th').map((_, th) => $(th).text().trim()).get();
  if (cabRR.length) {
    const idxRR = (nombreCol) => cabRR.findIndex(c => c.toLowerCase() === nombreCol.toLowerCase());
    const iDate = idxRR('Date'), iSurface = idxRR('Surface'), iScore = idxRR('Score'), iDR = idxRR('DR');
    $('#recent-results').find('tbody tr').each((_, tr) => {
      const celdas = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
      const score = iScore >= 0 ? celdas[iScore] : null;
      if (!score) return; // fila sin marcador = partido futuro/no jugado, se descarta
      const drVal = iDR >= 0 ? parseFloat(celdas[iDR]) : NaN;
      resultadosRecientes.push({
        fecha: iDate >= 0 ? parsearFechaTA(celdas[iDate]) : null,
        superficie: iSurface >= 0 ? celdas[iSurface] : null,
        dr: isNaN(drVal) ? null : drVal,
      });
    });
  }

  return { ...resultado, fuente: last52 ? 'last52' : (career ? 'career' : 'sin_dato'), url, resultadosRecientes };
}

const MESES_TA = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function parsearFechaTA(txt) {
  const m = (txt || '').match(/(\d{2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const mes = MESES_TA[m[2]];
  if (mes == null) return null;
  return new Date(parseInt(m[3], 10), mes, parseInt(m[1], 10));
}

module.exports = {
  slugNombre,
  descargarEloRatings,
  descargarYEloRatings,
  descargarSplitsJugador,
};
