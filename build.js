'use strict';
// Inserta data.json en la plantilla y escribe docs/index.html (la pagina que sirve GitHub Pages).
const fs = require('fs');
const path = require('path');
const dataFile = process.env.DATA || path.join(__dirname, 'data.json');
const j = JSON.stringify(JSON.parse(fs.readFileSync(dataFile, 'utf8'))).replace(/<\//g, '<\\/');
let t = fs.readFileSync(path.join(__dirname, 'page_template.html'), 'utf8').replace('/*__DATA__*/null', () => j);
// GitHub Pages sirve el fichero tal cual: hace falta el esqueleto HTML completo
t = '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  t.replace(/^<title>.*<\/title>\n/, '<title>OverEdge Auto</title>\n') + '\n</html>\n';
// el esqueleto de la herramienta de publicacion aportaba <body>; aqui se abre/cierra explicitamente
t = t.replace('<div class="wrap">', '<body>\n<div class="wrap">').replace('</script>\n\n</html>', '</script>\n</body>\n</html>');
fs.mkdirSync(path.join(__dirname, 'docs'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'docs', 'index.html'), t);
console.log('docs/index.html', t.length, 'bytes');
