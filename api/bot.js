// api/bot.js (Con Telegraf)

const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const https = require('https'); // Para descargar archivos
const { generatePdfFromFiles } = require('../generador.js'); // Importamos NUESTRO generador

// Directorio temporal de Vercel
const TEMP_DIR = '/tmp';

// El token lo leemos de las "Environment Variables" de Vercel
const TOKEN = process.env.TELEGRAM_TOKEN;
const bot = new Telegraf(TOKEN);

// Almacén simple para el estado del chat
const userState = {};

// 1. Comando /start
bot.start((ctx) => {
  const chatId = ctx.chat.id;
  userState[chatId] = { step: 'awaiting_excel' }; // Reinicia estado
  ctx.reply('¡Hola! Por favor, envíame el archivo Excel (.xlsx o .xls) con los nombres y cargos.');
});

// 2. Manejador de Archivos (Documentos)
bot.on('document', async (ctx) => {
  const chatId = ctx.chat.id;
  const doc = ctx.message.document;

  // Si no hay estado, iniciarlo
  if (!userState[chatId]) {
    userState[chatId] = { step: 'awaiting_excel' };
  }

  const currentState = userState[chatId];

  try {
    // ---- PASO 1: Esperando el EXCEL ----
    if (currentState.step === 'awaiting_excel') {
      if (doc.file_name.endsWith('.xlsx') || doc.file_name.endsWith('.xls')) {
        // Guardar el file_id del Excel y avanzar al siguiente paso
        currentState.excel_file_id = doc.file_id;
        currentState.step = 'awaiting_logo';
        await ctx.reply('¡Excel recibido! 👍 Ahora, por favor, envíame el archivo del logo (.png o .jpg) como un ARCHIVO.');
      } else {
        await ctx.reply('Eso no parece un archivo Excel. Por favor, envía un .xlsx o .xls. Si te trabaste, escribe /start');
      }
      return; // Salir para esperar el siguiente input
    }

    // ---- PASO 2: Esperando el LOGO ----
    if (currentState.step === 'awaiting_logo') {
      if (doc.file_name.endsWith('.png') || doc.file_name.endsWith('.jpg') || doc.file_name.endsWith('.jpeg')) {
        await ctx.reply('¡Logo recibido! 🤩 Generando tu PDF... Esto puede tardar unos segundos.');

        // ¡Tenemos todo! Descargar archivos
        const excelLink = await ctx.telegram.getFileLink(currentState.excel_file_id);
        const logoLink = await ctx.telegram.getFileLink(doc.file_id);

        const excelPath = path.join(TEMP_DIR, `datos_${chatId}.xlsx`);
        const logoPath = path.join(TEMP_DIR, `logo_${chatId}.png`);
        const outputPath = path.join(TEMP_DIR, `precedencias_${chatId}.pdf`);

        // Descargar ambos archivos
        await downloadFile(excelLink.href, excelPath);
        await downloadFile(logoLink.href, logoPath);

        // Llamar a nuestra lógica de PDFKit
        await generatePdfFromFiles(excelPath, logoPath, outputPath);

        // Enviar el PDF de vuelta
        await ctx.replyWithDocument({
          source: outputPath,
          filename: 'precedencias.pdf'
        });

        // Limpiar
        fs.unlinkSync(excelPath);
        fs.unlinkSync(logoPath);
        fs.unlinkSync(outputPath);
        delete userState[chatId]; // Listo, limpiar estado

      } else {
        await ctx.reply('Eso no parece un logo. Por favor, envía un archivo .png o .jpg.');
      }
    }

  } catch (error) {
    console.error('Error procesando archivo:', error.message);
    await ctx.reply('Hubo un error procesando tu solicitud. Por favor, intenta de nuevo con /start');
    delete userState[chatId]; // Limpiar estado en error
  }
});

// 3. Manejador para fotos (para guiar al usuario)
bot.on('photo', (ctx) => {
  const chatId = ctx.chat.id;
  if (userState[chatId] && userState[chatId].step === 'awaiting_logo') {
    ctx.reply('Casi... Por favor, envía el logo como **Archivo** (no como foto) para mantener la calidad.');
  } else {
    ctx.reply('No entendí eso. Escribe /start para comenzar.');
  }
});

// 4. Manejador de texto genérico
bot.on('message', (ctx) => {
  if (ctx.message.text && ctx.message.text !== '/start') {
    ctx.reply('No entendí eso. Por favor, envía los archivos que te pido. Escribe /start para (re)comenzar.');
  }
});

// --- Función de ayuda para descargar archivos ---
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

// --- Esta es la función serverless ---
// Vercel llama a esta función con cada petición
module.exports = async (request, response) => {
  try {
    // Telegraf maneja el 'body' del request por nosotros
    await bot.handleUpdate(request.body);
  } catch (err) {
    console.error('Error al manejar el update:', err);
  }
  // Respondemos 200 (OK) a Telegram
  response.status(200).send('OK');
};