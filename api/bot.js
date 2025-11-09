/*
 * api/bot.js (Versión 5: Mejoras de UX y Comentarios)
 *
 * Este archivo es el "cerebro" serverless de tu bot de Telegram.
 * Se despliega en Vercel y maneja toda la lógica de la conversación.
 */

// --- 1. Importaciones de Módulos ---

// Telegraf es el framework principal del bot.
// Markup se usa para crear los botones inline.
const { Telegraf, Markup } = require("telegraf");

// Módulos nativos de Node.js para manejar archivos y URLs
const fs = require("fs");
const path = require("path");
const https = require("https"); // Necesario para descargar archivos desde Telegram

// ¡Importamos TU lógica de generación de PDF desde generador.js!
const { generatePdfFromFiles } = require("../generador.js");

// --- 2. Constantes y Configuración ---

// Vercel solo nos deja escribir archivos en el directorio /tmp
const TEMP_DIR = "/tmp";

// Leemos el Token secreto desde las Variables de Entorno de Vercel
// ¡Nunca escribas el token directamente en el código!
const TOKEN = process.env.TELEGRAM_TOKEN;

// Creamos la instancia del bot
const bot = new Telegraf(TOKEN);

// Este objeto 'userState' es nuestra "mini base de datos".
// Guarda en qué paso de la conversación está cada usuario.
// Ej: userState[chatId] = { step: 'awaiting_excel', excel_file_id: '...' }
const userState = {};

// --- 3. Funciones de Ayuda (Helpers) ---

/**
 * Genera una cadena de texto con la fecha y hora actual en Venezuela (UTC-4).
 * @returns {string} Ej: "2025-11-08_20-15-10"
 */
function getLocalTimestamp() {
  const now = new Date();

  // Opciones para formatear en la zona horaria de Venezuela
  const options = {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false, // Formato de 24 horas
  };

  // 'sv-SE' (Sueco) nos da el formato YYYY-MM-DD HH:mm:ss, que es fácil de manipular
  const dateTimeString = now.toLocaleString("sv-SE", options);

  // Reemplazamos los caracteres no seguros para nombres de archivo
  // "2025-11-08 20:15:10" -> "2025-11-08_20-15-10"
  return dateTimeString
    .replace(" ", "_") // Reemplaza espacio por guion bajo
    .replace(/:/g, "-"); // Reemplaza todos los : por guiones
}

/**
 * Descarga un archivo desde una URL de Telegram a un destino local.
 * @param {string} url - La URL de descarga (ej: link.href)
 * @param {string} dest - El path de destino (ej: /tmp/archivo.xlsx)
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    https
      .get(url, (response) => {
        response.pipe(file);
        file.on("finish", () => {
          file.close(resolve);
        });
      })
      .on("error", (err) => {
        // Si hay error, borra el archivo incompleto
        fs.unlink(dest, () => reject(err));
      });
  });
}

// --- 4. Lógica del Bot (Manejadores) ---

/**
 * 4.1. Comando /start
 * Se activa cuando el usuario inicia la conversación.
 */
bot.start((ctx) => {
  const chatId = ctx.chat.id;
  // (Re)iniciamos el estado del usuario
  userState[chatId] = { step: "awaiting_excel" };

  ctx.reply(
    "¡Bienvenido! 👋 Soy tu asistente para generar Precedencias.\n\n" +
      "Para comenzar, por favor envíame el archivo Excel (.xlsx o .xls) con los nombres y cargos."
  );
});

/**
 * 4.2. Manejador de Documentos
 * Se activa cuando el usuario envía CUALQUIER archivo (documento).
 * Aquí manejamos el Excel y el Logo personalizado.
 */
bot.on("document", async (ctx) => {
  const chatId = ctx.chat.id;
  const doc = ctx.message.document;

  // Si el usuario no está en nuestra "base de datos", lo iniciamos
  if (!userState[chatId]) {
    userState[chatId] = { step: "awaiting_excel" };
  }
  const currentState = userState[chatId];

  try {
    // --- Lógica para el PASO 1: Esperando el EXCEL ---
    if (currentState.step === "awaiting_excel") {
      // Verificamos la extensión del archivo
      if (doc.file_name.endsWith(".xlsx") || doc.file_name.endsWith(".xls")) {
        // ¡Es un Excel! Guardamos su file_id
        currentState.excel_file_id = doc.file_id;
        // Avanzamos al siguiente paso
        currentState.step = "awaiting_logo_choice";

        // Respondemos con los botones inline
        await ctx.reply(
          "¡Excelente! Archivo Excel recibido. 👍\n\nAhora, ¿qué logo quieres usar para tu PDF?",
          Markup.inlineKeyboard([
            // Cada botón en su propio array [ ] crea una nueva fila (apilados)
            [Markup.button.callback("1️⃣ Logo Gobernación", "logo_gob")],
            [Markup.button.callback("2️⃣ Escudo Edo La Guaira", "logo_escudo_edo")],
            [Markup.button.callback("3️⃣ Subir otro logo", "logo_upload")],
          ])
        );
      } else {
        // El archivo no es un Excel
        await ctx.reply(
          "Ups, ese archivo no parece ser un Excel. 😅\nPor favor, envíame un archivo `.xlsx` o `.xls`. Si te trabaste, escribe /start"
        );
      }
      return; // Salimos y esperamos la siguiente acción del usuario
    }

    // --- Lógica para el PASO 3: Esperando el LOGO SUBIDO ---
    // (El usuario llega aquí solo si en el Paso 2 presionó "Subir otro logo")
    if (currentState.step === "awaiting_logo_upload") {
      // Verificamos que sea una imagen
      if (
        doc.file_name.endsWith(".png") ||
        doc.file_name.endsWith(".jpg") ||
        doc.file_name.endsWith(".jpeg")
      ) {
        await ctx.reply(
          "¡Logo personalizado recibido! 🖼️ Generando tu PDF... Esto puede tardar unos segundos."
        );

        // 1. Generar nombre de archivo único
        const timestamp = getLocalTimestamp(); // Ej: "2025-11-08_20-15-10"
        const finalFilename = `precedencias ${timestamp}.pdf`;

        // 2. Obtener URLs de descarga de Telegram
        const excelLink = await ctx.telegram.getFileLink(
          currentState.excel_file_id
        );
        const logoLink = await ctx.telegram.getFileLink(doc.file_id); // El logo que se acaba de subir

        // 3. Definir paths temporales en Vercel
        const excelPath = path.join(TEMP_DIR, `datos_${chatId}.xlsx`);
        const logoPath = path.join(TEMP_DIR, `logo_${chatId}.png`);
        const outputPath = path.join(TEMP_DIR, `temp_pdf_${chatId}.pdf`); // Path temporal de salida

        // 4. Descargar ambos archivos
        await downloadFile(excelLink.href, excelPath);
        await downloadFile(logoLink.href, logoPath);

        // 5. ¡Llamar a tu lógica!
        await generatePdfFromFiles(excelPath, logoPath, outputPath);

        // 6. Enviar el PDF de vuelta
        await ctx.replyWithDocument({
          source: outputPath,
          filename: finalFilename, // Usamos el nombre bonito
        });

        // 7. Limpiar archivos temporales
        fs.unlinkSync(excelPath);
        fs.unlinkSync(logoPath);
        fs.unlinkSync(outputPath);
        delete userState[chatId]; // Limpiar estado del usuario
      } else {
        await ctx.reply(
          "Eso no parece un logo. Por favor, envía un archivo `.png` o `.jpg`."
        );
      }
    }
  } catch (error) {
    console.error("Error procesando archivo:", error.message);
    await ctx.reply(
      "¡Oh no! 😫 Hubo un error procesando tu solicitud. Por favor, intenta de nuevo con /start"
    );
    delete userState[chatId]; // Limpiar estado en error
  }
});

/**
 * 4.3. Manejador de Clics en Botones (Callback Query)
 * Se activa cuando el usuario presiona uno de los botones inline.
 */
bot.on("callback_query", async (ctx) => {
  const chatId = ctx.chat.id;
  // 'choice' será 'logo_gob', 'logo_escudo_edo', o 'logo_upload'
  const choice = ctx.callbackQuery.data;

  // Responde al clic inmediatamente para que el botón deje de "cargar"
  await ctx.answerCbQuery();

  // Verificación de seguridad: ¿Está el usuario en el paso correcto?
  if (!userState[chatId] || userState[chatId].step !== "awaiting_logo_choice") {
    await ctx.reply(
      "Parece que hubo un error de estado. Por favor, empieza de nuevo con /start"
    );
    return;
  }

  const currentState = userState[chatId];

  try {
    // --- Opción 3: El usuario quiere SUBIR su logo ---
    if (choice === "logo_upload") {
      // Cambiamos el estado para que el manejador de 'document' sepa qué hacer
      currentState.step = "awaiting_logo_upload";
      // Editamos el mensaje original (quitando los botones)
      await ctx.editMessageText(
        "¡Entendido! Sube tu logo personalizado. 🖼️\n\n" +
          "Recuerda enviarlo como <b>Archivo</b> (no como foto) para la mejor calidad.",
        { parse_mode: "HTML" } // Usamos HTML para la negrita
      );
    } else {
      // --- Opción 1 o 2: El usuario eligió un LOGO PRECARGADO ---
      let logoName = ""; // El nombre del archivo (ej: logo-gob.png)
      let friendlyName = ""; // El nombre para el mensaje (ej: Logo Gobernación)

      if (choice === "logo_gob") {
        logoName = "logo-gob.png";
        friendlyName = "Logo Gobernación";
      } else if (choice === "logo_escudo_edo") {
        logoName = "logo-escudo-edo.png";
        friendlyName = "Escudo Edo La Guaira";
      }

      // Editamos el mensaje, quitando botones y AÑADIENDO NEGrita
      await ctx.editMessageText(
        `¡Perfecto! 🤩 Generando tu PDF con el <b>${friendlyName}</b>.`,
        { parse_mode: "HTML" } // ¡Aquí usamos HTML para la negrita!
      );

      // 1. Construir el path al logo precargado
      // __dirname es el directorio actual (ej: /var/task/api)
      // '..' sube un nivel (ej: /var/task)
      // 'logos' entra a tu carpeta de logos
      const logoPath = path.join(__dirname, "..", "logos", logoName);

      // 2. Generar nombre de archivo
      const timestamp = getLocalTimestamp();
      const finalFilename = `precedencias ${timestamp}.pdf`;

      // 3. Obtener URL y definir paths temporales
      const excelLink = await ctx.telegram.getFileLink(
        currentState.excel_file_id
      );
      const excelPath = path.join(TEMP_DIR, `datos_${chatId}.xlsx`);
      const outputPath = path.join(TEMP_DIR, `temp_pdf_${chatId}.pdf`);

      // 4. Descargar SOLO el Excel
      await downloadFile(excelLink.href, excelPath);

      // 5. ¡Llamar a tu lógica! (Usando el logo local)
      await generatePdfFromFiles(excelPath, logoPath, outputPath);

      // 6. Enviar el PDF
      await ctx.replyWithDocument({
        source: outputPath,
        filename: finalFilename,
      });

      // 7. Limpiar
      fs.unlinkSync(excelPath);
      fs.unlinkSync(outputPath); // Solo borramos los archivos de /tmp
      delete userState[chatId]; // Limpiar estado
    }
  } catch (error) {
    console.error("Error en callback:", error.message);
    await ctx.reply(
      "¡Oh no! 😫 Hubo un error con tu selección. Por favor, intenta de nuevo con /start"
    );
    delete userState[chatId];
  }
});

/**
 * 4.4. Manejador de Fotos
 * Se activa si el usuario envía una FOTO (en lugar de un Archivo/Documento).
 * Lo usamos para guiarlo a que lo haga de la forma correcta.
 */
bot.on("photo", async (ctx) => {
  const chatId = ctx.chat.id;
  // Verificamos si estaba en un paso donde esperamos un logo
  if (
    userState[chatId] &&
    (userState[chatId].step === "awaiting_logo_choice" ||
      userState[chatId].step === "awaiting_logo_upload")
  ) {
    await ctx.reply(
      "¡Casi! 📸 Veo que enviaste una foto.\n\n" +
        "Para asegurar la máxima calidad en el PDF, por favor envíalo como <b>Archivo</b> (usando el 📎).",
      { parse_mode: "HTML" }
    );
  } else {
    // Si no, es un mensaje genérico
    await ctx.reply(
      "Mmm, no entendí eso. 😅 Si quieres crear un PDF, por favor escribe /start para comenzar el proceso."
    );
  }
});

/**
 * 4.5. Manejador de Texto Genérico
 * Se activa si el usuario escribe cualquier texto que no sea un comando.
 */
bot.on("message", (ctx) => {
  // Verificamos que sea texto y no un comando que ya manejamos
  if (ctx.message.text && ctx.message.text !== "/start") {
    ctx.reply(
      "Mmm, no entendí ese comando. 😅 Si quieres crear un PDF, por favor escribe /start para comenzar el proceso."
    );
  }
});

// --- 5. El Manejador Principal de Vercel ---

/**
 * Esta es la función serverless principal.
 * Vercel ejecuta esto CADA VEZ que Telegram envía un update (mensaje, clic, etc.).
 */
module.exports = async (request, response) => {
  try {
    // Telegraf procesa el 'body' del request de forma segura
    await bot.handleUpdate(request.body);
  } catch (err) {
    console.error("Error al manejar el update de Telegram:", err);
  }

  // ¡CRÍTICO! Siempre respondemos 200 (OK) a Telegram.
  // Si no, Telegram pensará que el mensaje falló y lo seguirá reintentando,
  // lo que causaría que el bot responda múltiples veces.
  response.status(200).send("OK");
};
