// generador.js (Modificado para ser un módulo)

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const PDFDocument = require('pdfkit');

// Parámetros de diseño de la tarjeta
const CARD = {
  width: 280,
  height: 95,
  gapX: 20,
  gapY: 15,
  margin: 15
};

// Esta es la nueva función "envoltura" que el bot llamará
async function generatePdfFromFiles(inputFile, logoFile, outputPdf) {
  // Leer Excel y parsear
  const workbook = xlsx.readFile(inputFile);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  if (!rows.length) {
    throw new Error('El archivo Excel está vacío.');
  }

  // Detectar columnas dinámicamente
  const headers = Object.keys(rows[0]);
  let nombreKey = headers.find(h => /nombre/i.test(h));
  let cargoKey = headers.find(h => /cargo/i.test(h));
  if (!nombreKey || !cargoKey) {
    if (headers.length === 2) [nombreKey, cargoKey] = headers;
    else { throw new Error('Encabezados inválidos.'); }
  }

  // Normalizar datos
  const data = rows.map(r => ({
    name: String(r[nombreKey]).toUpperCase(),
    position: String(r[cargoKey]).toUpperCase()
  }));

  // Llamamos a tu función original de generación de PDF
  await generatePdf(data, logoFile, outputPdf);
  console.log(`PDF generado en: ${outputPdf}`);
}

/**
 * generatePdf: esta es tu lógica original, sin cambios.
 * Genera el PDF con tarjetas y líneas de recorte.
 */
function generatePdf(data, logoFile, outputPdf) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: CARD.margin });
    
    // Registrar Arial (¡Asegúrate que los .ttf estén en la misma carpeta!)
    doc.registerFont('Arial', path.join(__dirname, 'Arial.ttf'));
    doc.registerFont('Arial-Bold', path.join(__dirname, 'Arial-Bold.ttf'));

    const stream = fs.createWriteStream(outputPdf);
    doc.pipe(stream);

    const pageW = doc.page.width, pageH = doc.page.height;
    const columns = Math.floor((pageW - 2 * CARD.margin + CARD.gapX) / (CARD.width + CARD.gapX));
    const rowsCount = Math.floor((pageH - 2 * CARD.margin + CARD.gapY) / (CARD.height + CARD.gapY));
    const perPage = columns * rowsCount;
    const logoPath = logoFile; // Usamos el path que nos llega

    // Páginas
    for (let p = 0; p * perPage < data.length; p++) {
      if (p > 0) doc.addPage();
      const pageItems = data.slice(p * perPage, p * perPage + perPage);
      // Dibujar tarjetas
      pageItems.forEach((item, i) => {
        const c = i % columns, r = Math.floor(i / columns);
        const x = CARD.margin + c * (CARD.width + CARD.gapX);
        const y = CARD.margin + r * (CARD.height + CARD.gapY);
        // tarjeta
        doc.save().lineWidth(2).strokeColor('#0737AA')
          .rect(x, y, CARD.width, CARD.height).stroke().restore();
        // logo centrado vertical
        try {
          const img = doc.openImage(logoPath);
          const iw = 80, ih = img.height / img.width * iw;
          doc.image(logoPath, x + 8, y + (CARD.height - ih) / 2, { width: iw });
        } catch (e) {
          console.error("Error al cargar logo:", e.message);
        }
        // área texto
        const padL = 10, padR = 10, spacing = 4;
        const tx = x + 8 + 80 + padL, tw = CARD.width - (80 + 8 + padL + padR);
        // nombre ajustable
        let ns = 14, nh;
        for (let sz = 14; sz >= 6; sz--) {
          doc.font('Arial-Bold').fontSize(sz);
          nh = doc.heightOfString(item.name, { width: tw, align: 'center' });
          if (nh <= sz * 1.2 * 2) { ns = sz; break; }
        }
        doc.font('Arial-Bold').fontSize(ns);
        nh = doc.heightOfString(item.name, { width: tw, align: 'center' });
        // cargo ajustable
        let ps = 10, ph;
        for (let sz = 10; sz >= 6; sz--) {
          doc.font('Arial').fontSize(sz);
          ph = doc.heightOfString(item.position, { width: tw, align: 'center' });
          if (ph <= sz * 1.2 * 2) { ps = sz; break; }
        }
        doc.font('Arial').fontSize(ps);
        ph = doc.heightOfString(item.position, { width: tw, align: 'center' });
        // centrar vertical texto
        const th = nh + spacing + ph, ty = y + (CARD.height - th) / 2;
        doc.font('Arial-Bold').fontSize(ns)
          .text(item.name, tx, ty, { width: tw, align: 'center' });
        doc.font('Arial').fontSize(ps)
          .text(item.position, tx, ty + nh + spacing, { width: tw, align: 'center' });
      });
      // líneas de recorte
      doc.save().lineWidth(0.5).strokeColor('#999').dash(5, { space: 5 });
      // verticales
      for (let c = 1; c < columns; c++) {
        const xL = CARD.margin + c * (CARD.width + CARD.gapX) - CARD.gapX / 2;
        doc.moveTo(xL, CARD.margin - 5).lineTo(xL, pageH - CARD.margin + 5).stroke();
      }
      // horizontales
      for (let r = 1; r < rowsCount; r++) {
        const yL = CARD.margin + r * (CARD.height + CARD.gapY) - CARD.gapY / 2;
        doc.moveTo(CARD.margin - 5, yL).lineTo(pageW - CARD.margin + 5, yL).stroke();
      }
      doc.undash().restore();
    }

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// ¡Lo más importante! Exportamos la función para que bot.js la use.
module.exports = { generatePdfFromFiles };