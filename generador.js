// generador.js (Versión: 10 tarjetas, Logo centrado, Borde Negro, Ajuste a 4 líneas)

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const PDFDocument = require('pdfkit');

// Parámetros de diseño de la tarjeta
const CARD = {
    width: 280,
    // Altura ajustada para 10 tarjetas por página (5 filas)
    height: 140, 
    gapX: 20,
    gapY: 15,
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
 * generatePdf: Contiene toda la lógica de maquetación y dibujo.
 */
function generatePdf(data, logoFile, outputPdf, fontChoice) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'LETTER', margin: CARD.margin });
        
        // Registrar Arial (Se ignora fontChoice por ahora, se usa Arial por defecto)
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
                
                // tarjeta (Borde Negro, Grosor 2)
                doc.save().lineWidth(1).strokeColor('#000000') 
                  .rect(x, y, CARD.width, CARD.height).stroke().restore();
                
                // --- Lógica del Logo Centrado ---
                let logoActualHeight = 0; // Inicializamos a 0
                try {
                    const img = doc.openImage(logoPath);
                    const iw = 60; 
                    logoActualHeight = img.height / img.width * iw;
                    const logoX = x + (CARD.width - iw) / 2;
                    // Posicionamiento Y: 10 puntos desde el borde superior de la tarjeta (y)
                    doc.image(logoPath, logoX, y + 10, { width: iw });
                } catch (e) {
                    console.error("Error al cargar logo:", e.message);
                }

                // --- Definición del Área de Texto ---
                const padX = 15, spacing = 4; // Margen horizontal (15) y vertical (4)
                const tx = x + padX; // Posición X del texto (desde el margen de la tarjeta)
                const tw = CARD.width - (2 * padX); // Ancho del texto
                
                // --- AJUSTE DE TAMAÑO PARA EL NOMBRE (Máx. 4 líneas) ---
                let ns = 14, nh; 
                for (let sz = 14; sz >= 6; sz--) {
                    doc.font('Arial-Bold').fontSize(sz);
                    nh = doc.heightOfString(item.name, { width: tw, align: 'center' });
                    // Condición: cabe en 4 líneas o menos
                    if (nh <= sz * 1.2 * 4) { 
                        ns = sz; 
                        break; 
                    }
                }
                doc.font('Arial-Bold').fontSize(ns);
                nh = doc.heightOfString(item.name, { width: tw, align: 'center' });

                // --- AJUSTE DE TAMAÑO PARA EL CARGO (Máx. 4 líneas) ---
                let ps = 11, ph;
                for (let sz = 11; sz >= 6; sz--) {
                    doc.font('Arial').fontSize(sz);
                    ph = doc.heightOfString(item.position, { width: tw, align: 'center' });
                    // Condición: cabe en 4 líneas o menos
                    if (ph <= sz * 1.2 * 4) { 
                        ps = sz; 
                        break; 
                    }
                }
                doc.font('Arial').fontSize(ps);
                ph = doc.heightOfString(item.position, { width: tw, align: 'center' });
                
                // --- Centrado Vertical del Texto (Debajo del Logo) ---
                const th = nh + spacing + ph; // Altura total del bloque de texto
                
                // Altura que ocupa el logo + márgenes (10 sup, 10 inf)
                const logoH = logoActualHeight > 0 ? (10 + logoActualHeight + 10) : 0; 
                
                // Espacio restante para el texto
                const remainingH = CARD.height - logoH;
                
                // Calcular el Y de inicio del texto
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