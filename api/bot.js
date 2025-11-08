// api/bot.js (¡Versión 3, con botones!)

const { Telegraf, Markup } = require('telegraf'); // Importamos 'Markup' para los botones
const fs = require('fs');
const path = require('path');
const https = require('https');
const { generatePdfFromFiles } = require('../generador.js');

const TEMP_DIR = '/tmp';
const TOKEN = process.env.TELEGRAM_TOKEN;
const bot = new Telegraf(TOKEN);

// Almacén de estado (ahora con más pasos)
const userState = {};

// 1. Comando /start (sin cambios)
bot.start((ctx) => {
  const chatId = ctx.chat.id;
  userState[chatId] = { step: 'awaiting_excel' };
  ctx.reply('¡Hola! Por favor, envíame el archivo Excel (.xlsx o .xls) con los nombres y cargos.');
});

// 2. Manejador de Archivos (Documentos)
bot.on('document', async (ctx) => {
  const chatId = ctx.chat.id;
  const doc = ctx.message.document;

  if (!userState[chatId]) {
    userState[chatId] = { step: 'awaiting_excel' };
  }
  const currentState = userState[chatId];

  try {
    // ---- PASO 1: Esperando el EXCEL ----
    if (currentState.step === 'awaiting_excel') {
      if (doc.file_name.endsWith('.xlsx') || doc.file_name.endsWith('.xls')) {
        
        // Guardamos el excel_file_id como antes
        currentState.excel_file_id = doc.file_id;
        // CAMBIO: Avanzamos al paso de "elegir logo"
        currentState.step = 'awaiting_logo_choice';

        // CAMBIO: Enviamos el mensaje CON BOTONES INLINE
        await ctx.reply('¡Excel recibido! 👍 Ahora, ¿qué logo quieres usar?',
          Markup.inlineKeyboard([
            Markup.button.callback('Logo Gobierno', 'logo_gob'),
            Markup.button.callback('Escudo Edo.', 'logo_escudo_edo'),
            Markup.button.callback('Subir mi logo', 'logo_upload')
          ])
        );

      } else {
        await ctx.reply('Eso no parece un archivo Excel. Por favor, envía un .xlsx o .xls. Si te trabaste, escribe /start');
      }
      return;
    }

    // ---- PASO 3: Esperando el LOGO SUBIDO (si el usuario eligió "Subir mi logo") ----
    if (currentState.step === 'awaiting_logo_upload') {
      if (doc.file_name.endsWith('.png') || doc.file_name.endsWith('.jpg') || doc.file_name.endsWith('.jpeg')) {
        
        await ctx.reply('¡Logo personalizado recibido! 🤩 Generando tu PDF...');

        const excelLink = await ctx.telegram.getFileLink(currentState.excel_file_id);
        const logoLink = await ctx.telegram.getFileLink(doc.file_id); // El logo que se acaba de subir

        const excelPath = path.join(TEMP_DIR, `datos_${chatId}.xlsx`);
        const logoPath = path.join(TEMP_DIR, `logo_${chatId}.png`);
        const outputPath = path.join(TEMP_DIR, `precedencias_${chatId}.pdf`);

        await downloadFile(excelLink.href, excelPath);
        await downloadFile(logoLink.href, logoPath);

        // Llamamos a la misma función de siempre
        await generatePdfFromFiles(excelPath, logoPath, outputPath);

        await ctx.replyWithDocument({ source: outputPath, filename: 'precedencias.pdf' });

        fs.unlinkSync(excelPath);
        fs.unlinkSync(logoPath);
        fs.unlinkSync(outputPath);
        delete userState[chatId]; // Limpiar estado

      } else {
        await ctx.reply('Eso no parece un logo. Por favor, envía un archivo .png o .jpg.');
      }
    }

  } catch (error) {
    console.error('Error procesando archivo:', error.message);
    await ctx.reply('Hubo un error procesando tu solicitud. Por favor, intenta de nuevo con /start');
    delete userState[chatId];
  }
});

// 3. ¡NUEVO! Manejador de Clics en Botones (Callback Query)
bot.on('callback_query', async (ctx) => {
  const chatId = ctx.chat.id;
  const choice = ctx.callbackQuery.data; // Ej: 'logo_gob', 'logo_escudo_edo', 'logo_upload'
  
  // Siempre responde al "clic" para que el botón deje de cargar
  await ctx.answerCbQuery();

  if (!userState[chatId] || userState[chatId].step !== 'awaiting_logo_choice') {
    await ctx.reply('Error de estado. Por favor, empieza de nuevo con /start');
    return;
  }

  const currentState = userState[chatId];

  try {
    if (choice === 'logo_upload') {
      // ---- Opción 3: Subir logo ----
      currentState.step = 'awaiting_logo_upload'; // Cambiamos el estado
      // Editamos el mensaje original para quitar los botones
      await ctx.editMessageText('OK. Por favor, sube tu archivo de logo personalizado (.png o .jpg).');
    
    } else {
      // ---- Opción 1 o 2: Logo precargado ----
      let logoName = '';
      let friendlyName = '';

      if (choice === 'logo_gob') {
        logoName = 'logo-gob.png';
        friendlyName = 'Logo Gobierno';
      } else if (choice === 'logo_escudo_edo') {
        logoName = 'logo-escudo-edo.png';
        friendlyName = 'Escudo Edo.';
      }
      
      await ctx.editMessageText(`¡Entendido! 🤩 Generando tu PDF con el logo "${friendlyName}"...`);

      // ¡Aquí está la magia! Usamos el logo local, no uno descargado
      // path.join(__dirname, '..', 'logos', logoName)
      // __dirname es /api, '..' sube un nivel, y 'logos' entra a la carpeta
      const logoPath = path.join(__dirname, '..', 'logos', logoName);
      
      const excelLink = await ctx.telegram.getFileLink(currentState.excel_file_id);
      const excelPath = path.join(TEMP_DIR, `datos_${chatId}.xlsx`);
      const outputPath = path.join(TEMP_DIR, `precedencias_${chatId}.pdf`);

      await downloadFile(excelLink.href, excelPath);

      // ¡Llamamos al generador con el path del logo local!
      await generatePdfFromFiles(excelPath, logoPath, outputPath);

      await ctx.replyWithDocument({ source: outputPath, filename: 'precedencias.pdf' });

      fs.unlinkSync(excelPath);
      fs.unlinkSync(outputPath);
      delete userState[chatId]; // Limpiar estado
    }

  } catch (error) {
    console.error('Error en callback:', error.message);
    await ctx.reply('Hubo un error. Por favor, intenta de nuevo con /start');
    delete userState[chatId];
  }
});


// 4. Manejador para fotos (sin cambios)
bot.on('photo', (ctx) => {
  const chatId = ctx.chat.id;
  if (userState[chatId] && (userState[chatId].step === 'awaiting_logo_choice' || userState[chatId].step === 'awaiting_logo_upload')) {
    ctx.reply('Casi... Por favor, envía el logo como **Archivo** (no como foto) para mantener la calidad.');
  } else {
    ctx.reply('No entendí eso. Escribe /start para comenzar.');
  }
});

// 5. Manejador de texto genérico (sin cambios)
bot.on('message', (ctx) => {
  if (ctx.message.text && ctx.message.text !== '/start') {
    ctx.reply('No entendí eso. Por favor, envía los archivos que te pido. Escribe /start para (re)comenzar.');
  }
});

// --- Función de ayuda para descargar archivos (sin cambios) ---
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

// --- Función serverless (sin cambios) ---
module.exports = async (request, response) => {
  try {
    await bot.handleUpdate(request.body);
  } catch (err) {
    console.error('Error al manejar el update:', err);
  }
  response.status(200).send('OK');
};