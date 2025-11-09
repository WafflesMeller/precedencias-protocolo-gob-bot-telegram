// generador.js (Final: 10 tarjetas, Logo centrado [Altura Fija 60pt], Borde Negro, Ajuste a 4 líneas, Detección de Encabezado)

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

// Esta es la función "envoltura" que el bot llamará
async function generatePdfFromFiles(inputFile, logoFile, outputPdf, fontChoice = 'Arial') {
    
    // --- 1. Leer el archivo Excel y la hoja ---
    const workbook = xlsx.readFile(inputFile);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    
    if (!sheet) {
        throw new Error('La hoja de cálculo está vacía o no existe.');
    }

    // --- 2. DETECCIÓN INTELIGENTE DE ENCABEZADOS ---
    // Leemos la hoja completa usando números (header: 1) para obtener todas las filas como arrays.
    const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (rawData.length === 0 || rawData[0].length < 2) {
        throw new Error('El archivo Excel no tiene datos o columnas suficientes (se necesitan al menos 2).');
    }

    const firstRow = rawData[0];
    let dataRows = rawData; // Por defecto, usamos todas las filas como datos.
    
    // Convertimos las dos primeras celdas de la primera fila a minúsculas para la detección.
    // Usamos || '' para manejar celdas nulas de forma segura.
    const firstCell = String(firstRow[0] || '').toLowerCase();
    const secondCell = String(firstRow[1] || '').toLowerCase();
    
    // Buscamos si la primera fila contiene 'nombre' Y 'cargo' en las dos primeras celdas
    if (firstCell.includes('nombre') && secondCell.includes('cargo')) {
        // Si encontramos encabezados, saltamos la primera fila de datos.
        dataRows = rawData.slice(1);
        // console.log("Encabezados detectados: Saltando la primera fila.");
    } else {
        // console.log("No se detectaron encabezados: Usando la primera fila como dato.");
    }

    if (dataRows.length === 0) {
        throw new Error('El archivo Excel no contiene datos útiles después de la detección/limpieza.');
    }

    // --- 3. Normalizar y Mapear Datos ---
    
    const data = dataRows
        // Mapeamos los datos, asumiendo Columna A (índice 0) es Nombre y Columna B (índice 1) es Cargo
        .map(row => ({
            // Aseguramos que solo usamos los valores de las dos primeras columnas
            name: String(row[0] || '').toUpperCase(),
            position: String(row[1] || '').toUpperCase()
        }))
        // Filtramos filas que pueden haber quedado vacías
        .filter(item => item.name || item.position);

    if (data.length === 0) {
        throw new Error('El archivo Excel no contiene datos útiles después de la limpieza.');
    }

    // --- 4. Generar PDF ---
    // fontChoice se mantiene para una futura implementación
    await generatePdf(data, logoFile, outputPdf, fontChoice); 
    console.log(`PDF generado en: ${outputPdf}`);
}

/**
 * generatePdf: Contiene toda la lógica de maquetación y dibujo.
 * Mantiene la altura fija de 60pt y la maquetación de 10 tarjetas.
 */
function generatePdf(data, logoFile, outputPdf, fontChoice) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'LETTER', margin: CARD.margin });
        
        // Registrar Arial (Se usa Arial por defecto)
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
                
                // tarjeta (Borde Negro, Grosor 1)
                doc.save().lineWidth(1).strokeColor('#000000') 
                  .rect(x, y, CARD.width, CARD.height).stroke().restore();
                
                // --- Lógica del Logo Centrado (Altura Fija 60pt) ---
                let logoActualHeight = 0; // Inicializamos a 0. Solo se asigna si el logo carga con éxito.
                try {
                    const img = doc.openImage(logoPath);
                    const fixedHeight = 60; // ALTURA FIJA: 60 puntos
                    const ih = fixedHeight; 
                    const iw = img.width / img.height * ih; // Calcular ancho dinámico
                    
                    const logoX = x + (CARD.width - iw) / 2;
                    // Posicionamiento Y: 10 puntos desde el borde superior de la tarjeta (y)
                    doc.image(logoPath, logoX, y + 10, { width: iw, height: ih });
                    
                    // Asignamos el valor fijo SOLO si la imagen se dibujó con éxito
                    logoActualHeight = fixedHeight; 

                } catch (e) {
                    console.error("Error al cargar logo:", e.message);
                    // Si falla, logoActualHeight se queda en 0.
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
                // Usamos 10pt de margen superior y 10pt de separación al texto
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