// api/bot.js (¡Versión 4, con nombres de archivo dinámicos!)

const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const path = require("path");
const https = require("https");
const { generatePdfFromFiles } = require("../generador.js");

const TEMP_DIR = "/tmp";
const TOKEN = process.env.TELEGRAM_TOKEN;
const bot = new Telegraf(TOKEN);

const userState = {};

// ----------------------------------------------------------------------
// NUEVA FUNCIÓN: Para obtener la fecha y hora local de Venezuela
// ----------------------------------------------------------------------
function getLocalTimestamp() {
  const now = new Date();

  // Opciones para la zona horaria de Venezuela (UTC-4)
  const options = {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };

  // 'sv-SE' da el formato YYYY-MM-DD HH:mm:ss
  const dateTimeString = now.toLocaleString("sv-SE", options);

  // Reemplazamos para que sea seguro en un nombre de archivo
  // "2025-11-08 19:49:18" -> "2025-11-08_19-49-18"
  return dateTimeString.replace(" ", "_").replace(/:/g, "-");
}

// 1. Comando /start (sin cambios)
bot.start((ctx) => {
  const chatId = ctx.chat.id;
  userState[chatId] = { step: "awaiting_excel" };
  ctx.reply(
    "¡Hola! Por favor, envíame el archivo Excel (.xlsx o .xls) con los nombres y cargos."
  );
});

// 2. Manejador de Archivos (Documentos)
bot.on("document", async (ctx) => {
  const chatId = ctx.chat.id;
  const doc = ctx.message.document;

  if (!userState[chatId]) {
    userState[chatId] = { step: "awaiting_excel" };
  }
  const currentState = userState[chatId];

  try {
    // ---- PASO 1: Esperando el EXCEL ----
    if (currentState.step === "awaiting_excel") {
      if (doc.file_name.endsWith(".xlsx") || doc.file_name.endsWith(".xls")) {
        currentState.excel_file_id = doc.file_id;
        currentState.step = "awaiting_logo_choice";

        await ctx.reply(
          "¡Excel recibido! 👍 Ahora, ¿qué logo quieres usar?",
          Markup.inlineKeyboard([
            Markup.button.callback("Logo Gobernación", "logo_gob"),
            Markup.button.callback("Escudo Edo La Guaira", "logo_escudo_edo"),
            Markup.button.callback("Subir mi logo", "logo_upload"),
          ])
        );
      } else {
        await ctx.reply(
          "Eso no parece un archivo Excel. Por favor, envía un .xlsx o .xls. Si te trabaste, escribe /start"
        );
      }
      return;
    }

    // ---- PASO 3: Esperando el LOGO SUBIDO ----
    if (currentState.step === "awaiting_logo_upload") {
      if (
        doc.file_name.endsWith(".png") ||
        doc.file_name.endsWith(".jpg") ||
        doc.file_name.endsWith(".jpeg")
      ) {
        await ctx.reply("¡Logo personalizado recibido! 🤩 Generando tu PDF...");

        // CAMBIO: Generamos el nombre de archivo dinámico
        const timestamp = getLocalTimestamp(); // Ej: "2025-11-08_19-49-18"
        const finalFilename = `precedencias ${timestamp}.pdf`;

        const excelLink = await ctx.telegram.getFileLink(
          currentState.excel_file_id
        );
        const logoLink = await ctx.telegram.getFileLink(doc.file_id);

        const excelPath = path.join(TEMP_DIR, `datos_${chatId}.xlsx`);
        const logoPath = path.join(TEMP_DIR, `logo_${chatId}.png`);
        // El outputPath es temporal, así que puede ser simple
        const outputPath = path.join(TEMP_DIR, `precedencias_${chatId}.pdf`);

        await downloadFile(excelLink.href, excelPath);
        await downloadFile(logoLink.href, logoPath);

        await generatePdfFromFiles(excelPath, logoPath, outputPath);

        // CAMBIO: Usamos el 'finalFilename' que creamos
        await ctx.replyWithDocument({
          source: outputPath,
          filename: finalFilename,
        });

        fs.unlinkSync(excelPath);
        fs.unlinkSync(logoPath);
        fs.unlinkSync(outputPath);
        delete userState[chatId];
      } else {
        await ctx.reply(
          "Eso no parece un logo. Por favor, envía un archivo .png o .jpg."
        );
      }
    }
  } catch (error) {
    console.error("Error procesando archivo:", error.message);
    await ctx.reply(
      "Hubo un error procesando tu solicitud. Por favor, intenta de nuevo con /start"
    );
    delete userState[chatId];
  }
});

// 3. Manejador de Clics en Botones (Callback Query)
bot.on("callback_query", async (ctx) => {
  const chatId = ctx.chat.id;
  const choice = ctx.callbackQuery.data;

  await ctx.answerCbQuery();

  if (!userState[chatId] || userState[chatId].step !== "awaiting_logo_choice") {
    await ctx.reply("Error de estado. Por favor, empieza de nuevo con /start");
    return;
  }

  const currentState = userState[chatId];

  try {
    if (choice === "logo_upload") {
      currentState.step = "awaiting_logo_upload";
      await ctx.editMessageText(
        "OK. Por favor, sube tu archivo de logo personalizado (.png o .jpg)."
      );
    } else {
      let logoName = "";
      let friendlyName = "";

      if (choice === "logo_gob") {
        logoName = "logo-gob.png";
        friendlyName = "Logo Gobernación";
      } else if (choice === "logo_escudo_edo") {
        logoName = "logo-escudo-edo.png";
        friendlyName = "Escudo Edo La Guaira";
      }

      // Esta es la nueva línea con negrita:
      await ctx.editMessageText(
        `¡Entendido! 🤩 Generando tu PDF con el logo <b>${friendlyName}</b>...`,
        {
          parse_mode: "HTML",
        }
      );

      const logoPath = path.join(__dirname, "..", "logos", logoName);

      // CAMBIO: Generamos el nombre de archivo dinámico
      const timestamp = getLocalTimestamp(); // Ej: "2025-11-08_19-49-18"
      const finalFilename = `precedencias ${timestamp}.pdf`;

      const excelLink = await ctx.telegram.getFileLink(
        currentState.excel_file_id
      );
      const excelPath = path.join(TEMP_DIR, `datos_${chatId}.xlsx`);
      // El outputPath es temporal
      const outputPath = path.join(TEMP_DIR, `precedencias_${chatId}.pdf`);

      await downloadFile(excelLink.href, excelPath);

      await generatePdfFromFiles(excelPath, logoPath, outputPath);

      // CAMBIO: Usamos el 'finalFilename' que creamos
      await ctx.replyWithDocument({
        source: outputPath,
        filename: finalFilename,
      });

      fs.unlinkSync(excelPath);
      fs.unlinkSync(outputPath);
      delete userState[chatId];
    }
  } catch (error) {
    console.error("Error en callback:", error.message);
    await ctx.reply("Hubo un error. Por favor, intenta de nuevo con /start");
    delete userState[chatId];
  }
});

// 4. Manejador para fotos (sin cambios)
bot.on("photo", (ctx) => {
  const chatId = ctx.chat.id;
  if (
    userState[chatId] &&
    (userState[chatId].step === "awaiting_logo_choice" ||
      userState[chatId].step === "awaiting_logo_upload")
  ) {
    ctx.reply(
      "Casi... Por favor, envía el logo como **Archivo** (no como foto) para mantener la calidad."
    );
  } else {
    ctx.reply("No entendí eso. Escribe /start para comenzar.");
  }
});

// 5. Manejador de texto genérico (sin cambios)
bot.on("message", (ctx) => {
  if (ctx.message.text && ctx.message.text !== "/start") {
    ctx.reply(
      "No entendí eso. Por favor, envía los archivos que te pido. Escribe /start para (re)comenzar."
    );
  }
});

// --- Función de ayuda para descargar archivos (sin cambios) ---
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
        fs.unlink(dest, () => reject(err));
      });
  });
}

// --- Función serverless (sin cambios) ---
module.exports = async (request, response) => {
  try {
    await bot.handleUpdate(request.body);
  } catch (err) {
    console.error("Error al manejar el update:", err);
  }
  response.status(200).send("OK");
};
