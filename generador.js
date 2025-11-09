// generador.js (Modificado para ser un módulo)

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const PDFDocument = require('pdfkit');

// Parámetros de diseño de la tarjeta
const CARD = {
  width: 280,
  height: 140,
  gapX: 20,
  gapY: 10,
  margin: 15
};

// Esta es la nueva función "envoltura" que el bot llamará
async function generatePdfFromFiles(inputFile, logoFile, outputPdf, fontChoice = 'Arial') {
  // --- Leer el archivo Excel ---
    const workbook = xlsx.readFile(inputFile);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    
    if (!sheet) {
        throw new Error('La hoja de cálculo está vacía o no existe.');
    }
  // Leer Excel y parsear, asumiendo inicialmente que tiene encabezados (comportamiento actual)
  let rowsWithHeaders = xlsx.utils.sheet_to_json(sheet, { defval: '' });

  if (!rowsWithHeaders.length) {
      throw new Error('El archivo Excel está vacío o no contiene datos válidos.');
  }

  let dataToProcess = [];
  let nombreKey, cargoKey;

  // 1. INTENTO DE DETECCIÓN CON ENCABEZADOS (Lógica original)
  const headers = Object.keys(rowsWithHeaders[0]);
  nombreKey = headers.find(h => /nombre/i.test(h));
  cargoKey = headers.find(h => /cargo/i.test(h));

  // Si se encuentran las claves por nombre o se asume un orden (al menos 2 columnas)
  if (nombreKey && cargoKey) {
      dataToProcess = rowsWithHeaders;
  } else if (headers.length >= 2) {
      // Si no encontramos 'nombre'/'cargo', asumimos que las primeras dos columnas son
      // Nombre y Cargo respectivamente, usando sus nombres de encabezado.
      [nombreKey, cargoKey] = headers;
      dataToProcess = rowsWithHeaders;
  } else {
      // 2. ESCENARIO SIN ENCABEZADOS
      // Leemos la hoja completa, asumiendo que la fila 1 (índice 0) son datos.
      const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      if (rawData.length === 0 || rawData[0].length < 2) {
          throw new Error('El archivo Excel no tiene datos o columnas suficientes (se necesitan al menos 2).');
      }

      // Mapeamos los datos, asumiendo Columna A (índice 0) es Nombre y Columna B (índice 1) es Cargo
      dataToProcess = rawData.map(row => ({
          name: row[0],
          position: row[1] || ''
      }));

      // Definimos las claves para el siguiente paso
      nombreKey = 'name';
      cargoKey = 'position';
  }

  // 3. Normalizar datos
  // Filtramos filas que pueden haber quedado completamente vacías
  dataToProcess = dataToProcess.filter(item => item[nombreKey] || item[cargoKey]);

  if (dataToProcess.length === 0) {
      throw new Error('El archivo Excel no contiene datos útiles después de la limpieza.');
  }

  const data = dataToProcess.map(r => ({
      name: String(r[nombreKey]).toUpperCase(),
      position: String(r[cargoKey]).toUpperCase()
  }));

  // Llamamos a tu función original de generación de PDF
  await generatePdf(data, logoFile, outputPdf, fontChoice); 
  console.log(`PDF generado en: ${outputPdf}`);
}

/**
 * generatePdf: esta es tu lógica original, sin cambios.
 * Genera el PDF con tarjetas y líneas de recorte.
 */
function generatePdf(data, logoFile, outputPdf, fontChoice) {
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
      let logoActualHeight = 0; // Inicializamos a 0
        try {
          const img = doc.openImage(logoPath);
          const iw = 60; logoActualHeight = img.height / img.width * iw;
          const logoX = x + (CARD.width - iw) / 2;
          doc.image(logoPath, logoX, y + 10, { width: iw });
        } catch (e) {
          console.error("Error al cargar logo:", e.message);
        }
        // área texto
        const padX = 15, spacing = 4; // Un margen horizontal de 15 a cada lado
        const tx = x + padX; // Posición X del texto (desde el margen de la tarjeta)
        const tw = CARD.width - (2 * padX); // Ancho del texto
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
        // Centrar texto
        // Altura total del bloque de texto
          const th = nh + spacing + ph; 
          // Altura utilizada por el logo (margen superior 10 + altura del logo + separación inferior 10)
          const logoH = logoActualHeight > 0 ? (10 + logoActualHeight + 10) : 0;
          // Altura restante para el texto: Altura de la tarjeta - Altura del logo
          const remainingH = CARD.height - logoH;

          // Calcular el Y central: Posición Y de la tarjeta + Altura del logo + (Espacio restante - Altura del texto) / 2
          const ty = y + logoH + (remainingH - th) / 2; 

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