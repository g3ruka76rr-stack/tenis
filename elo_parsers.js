'use strict';
// Portado 1:1 desde PISTA_VERDE (mismas funciones que usa el panel de pegado en la app).

function parsearTablaEloTennisAbstract(texto, claveRank){
  const lineas = texto.split('\n').map(l=>l.trim()).filter(l=>l);
  const reFila = /^(\d+)\s+(.+?)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d{4}-\d{2})\s+(\d+)\s+(-?[\d.]+)\s*$/;
  const resultado = [];
  for (const linea of lineas){
    let campos = null;
    let idx = { nombre: 1, elo: 3, hElo: 5, cElo: 7, gElo: 9, rank: 12 };
    if (linea.includes('\t')){
      const celdas = linea.split('\t').map(c=>c.trim());
      if (celdas.length === 14 && /^\d+$/.test(celdas[0]) && /^\d{4}-\d{2}$/.test(celdas[11])){
        campos = celdas;
      } else if (celdas.length === 17 && /^\d+$/.test(celdas[0]) && /^\d{4}-\d{2}$/.test(celdas[13])){
        // Formato real que produce nuestro scraper (con celdas separadoras vacias entre
        // cada Rank y su valor, y edad a veces vacia -- ej. "Sofia Johnson" en WTA, fila
        // completa de Elo/hElo/cElo/gElo/WTARank pero sin Age rellenada por TennisAbstract).
        // Se usa indice POSICIONAL fijo (no depende de que Age tenga contenido).
        campos = celdas;
        idx = { nombre: 1, elo: 3, hElo: 6, cElo: 8, gElo: 10, rank: 15 };
      }
    }
    if (!campos){
      const m = reFila.exec(linea);
      if (m) campos = m.slice(1);
    }
    if (!campos) continue;
    const nombre = campos[idx.nombre].trim();
    const elo = parseFloat(campos[idx.elo]);
    const hElo = parseFloat(campos[idx.hElo]);
    const cElo = parseFloat(campos[idx.cElo]);
    const gElo = parseFloat(campos[idx.gElo]);
    const rank = parseInt(campos[idx.rank],10);
    if (!nombre || isNaN(elo)) continue;
    const entrada = { nombre, elo, hElo: isNaN(hElo)?null:hElo, cElo: isNaN(cElo)?null:cElo, gElo: isNaN(gElo)?null:gElo };
    entrada[claveRank] = isNaN(rank) ? null : rank;
    resultado.push(entrada);
  }
  return resultado;
}

function parsearTablaYEloTennisAbstract(texto, claveRank){
  const lineas = texto.split('\n').map(l=>l.trim()).filter(l=>l);
  const reFila = /^(\d+)\s+(.+?)\s+(\d+)\s+(\d+)\s+([\d.]+)\s*$/;
  const resultado = [];
  for (const linea of lineas){
    let campos = null;
    if (linea.includes('\t')){
      const celdas = linea.split('\t').map(c=>c.trim());
      if (celdas.length === 5 && /^\d+$/.test(celdas[0]) && /^\d+$/.test(celdas[2]) && /^\d+$/.test(celdas[3])){
        campos = celdas;
      }
    }
    if (!campos){
      const m = reFila.exec(linea);
      if (m) campos = m.slice(1);
    }
    if (!campos) continue;
    const nombre = campos[1].trim();
    const v = parseInt(campos[2],10);
    const d = parseInt(campos[3],10);
    const yelo = parseFloat(campos[4]);
    if (!nombre || isNaN(yelo)) continue;
    resultado.push({ nombre, yelo, v: isNaN(v)?null:v, d: isNaN(d)?null:d });
  }
  resultado.forEach((e,i)=>{ e[claveRank] = i+1; });
  return resultado;
}

module.exports = { parsearTablaEloTennisAbstract, parsearTablaYEloTennisAbstract };
