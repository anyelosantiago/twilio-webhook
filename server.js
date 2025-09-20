// server.js (Optimizado: compatibilidad + seguridad + historial)
const express = require("express");
const app = express();

// Middlewares
app.use(express.urlencoded({ extended: false })); // Twilio manda x-www-form-urlencoded
app.use(express.json());                          // También aceptamos JSON

// Almacenamiento en memoria con TTL
const inbox = new Map();
const MAX_STORAGE_TIME = 10 * 60 * 1000; // 10 minutos

// Regex precompiladas
const REGEX_PATTERNS = {
  gFormat: /\bG\s*-\s*(\d{4,8})\b/i,
  googleCode: /\bgoogle[^0-9]{0,40}(\d{4,8})\b/i,
  googleServices: /\b(google\s*voice|gmail|youtube|yt)[^0-9]{0,40}(\d{4,8})\b/i,
  useYour: /\b(?:use|your|tu|su)[^0-9]{0,20}(\d{4,8})\b/i,
  separatedCode: /(?<!\d)(?:\d[ \-\.]?){4,8}(?!\d)/,
  digitsOnly: /\b(\d{4,8})\b/
};

// Extraer código de verificación (4–8 dígitos) priorizando formatos Google
function extractCode(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const t = text.trim();
  let match;

  // 1) "G-123456" o "g-4444"
  if ((match = REGEX_PATTERNS.gFormat.exec(t))) return match[1];

  // 2) "Google ... <código>"
  if ((match = REGEX_PATTERNS.googleCode.exec(t))) return match[1];

  // 3) "Google Voice/Gmail/YouTube ... <código>"
  if ((match = REGEX_PATTERNS.googleServices.exec(t))) return match[2];

  // 4) "Use/Your/Tu/Su ... <código>"
  if ((match = REGEX_PATTERNS.useYour.exec(t))) return match[1];

  // 5) Evitar teléfonos largos (9+ dígitos seguidos)
  const noPhones = t.replace(/\d{9,}/g, " ");

  // 6) Códigos con separadores: "12 34 56", "12-34-56", "123 456"
  if ((match = REGEX_PATTERNS.separatedCode.exec(noPhones))) {
    const onlyDigits = match[0].replace(/\D+/g, "");
    if (onlyDigits.length >= 4 && onlyDigits <= 8) return onlyDigits;
  }

  // 7) Fallback: 4–8 dígitos limpios
  if ((match = REGEX_PATTERNS.digitsOnly.exec(noPhones))) return match[1];

  return null;
}

// Limpieza automática de registros viejos
setInterval(() => {
  const now = Date.now();
  for (const [from, list] of inbox.entries()) {
    if (!Array.isArray(list) || list.length === 0) {
      inbox.delete(from);
      continue;
    }
    const filtered = list.filter(item => now - item.at <= MAX_STORAGE_TIME);
    if (filtered.length) {
      inbox.set(from, filtered.slice(0, 5)); // mantener máx 5 recientes
    } else {
      inbox.delete(from);
    }
  }
}, 5 * 60 * 1000);

// Validación E.164
function validatePhoneNumber(req, res, next) {
  let from = req.params.from || req.query.from || req.body.from;
  if (from && typeof from === "string") from = decodeURIComponent(from);
  if (!from || !/^\+[1-9]\d{1,14}$/.test(from)) {
    return res.status(400).json({
      error: "Número inválido. Formato E.164 requerido, ej: +1234567890"
    });
  }
  req.validatedFrom = from;
  next();
}

// Verificación de firma Twilio (opcional si configuras TWILIO_AUTH_TOKEN en Railway)
function validateTwilioSignature(req, res, next) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.log("⚠️  TWILIO_AUTH_TOKEN no configurado - omitiendo verificación de firma");
    return next();
  }
  const signature = req.headers["x-twilio-signature"];
  const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  const params = req.body;
  try {
    const { validateRequest } = require("twilio");
    const isValid = validateRequest(authToken, signature, url, params);
    if (!isValid) {
      console.log("❌ Firma Twilio inválida - request bloqueado");
      return res.status(403).type("text/xml")
        .send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Invalid signature</Message></Response>`);
    }
    return next();
  } catch (e) {
    console.error("Error verificando firma Twilio:", e);
    return res.status(500).type("text/xml")
      .send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Server error</Message></Response>`);
  }
}

// --- Webhook Twilio ---
app.post("/sms-webhook", validateTwilioSignature, (req, res) => {
  const from = (req.body.From || "").trim(); // remitente (tu cel)
  const body = (req.body.Body || "").trim(); // texto SMS
  if (!from) {
    return res.type("text/xml").status(400)
      .send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Error: From required</Message></Response>`);
  }

  const code = extractCode(body);
  const timestamp = Date.now();

  if (!inbox.has(from)) inbox.set(from, []);
  const arr = inbox.get(from);
  arr.unshift({ code, last: body, at: timestamp });
  inbox.set(from, arr.slice(0, 5)); // mantener tope 5

  console.log(`[SMS] De: ${from} | Codigo: ${code || "N/A"} | Texto: ${body.substring(0, 80)}${body.length > 80 ? "..." : ""}`);

  res.type("text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
});

// --- API REST (nuevas rutas con :from) ---
app.get("/get-code/:from", validatePhoneNumber, (req, res) => {
  const list = inbox.get(req.validatedFrom);
  if (!list || list.length === 0) {
    return res.status(404).json({ found: false, code: null, last: null, at: null, error: "No messages found for this number" });
  }
  const data = list[0];
  res.json({ found: !!data.code, code: data.code, last: data.last, at: data.at });
});

app.get("/get-last/:from", validatePhoneNumber, (req, res) => {
  const list = inbox.get(req.validatedFrom);
  if (!list || list.length === 0) {
    return res.status(404).json({ found: false, last: null, at: null, error: "No messages found for this number" });
  }
  const data = list[0];
  res.json({ found: true, last: data.last, at: data.at });
});

app.delete("/consume-code/:from", validatePhoneNumber, (req, res) => {
  const from = req.validatedFrom;
  const list = inbox.get(from);
  if (!list || list.length === 0) {
    return res.status(404).json({ ok: false, reason: "not_found", error: "No messages found for this number" });
  }
  const used = list.shift();
  if (list.length === 0) inbox.delete(from); else inbox.set(from, list);
  res.json({ ok: true, used });
});

// --- API Legacy (compat con ?from=) ---
app.get("/get-code", validatePhoneNumber, (req, res) => {
  const list = inbox.get(req.validatedFrom);
  if (!list || list.length === 0) {
    return res.status(404).json({ found: false, code: null, last: null, at: null, error: "No messages found for this number" });
  }
  const data = list[0];
  res.json({ found: !!data.code, code: data.code, last: data.last, at: data.at });
});

app.get("/get-last", validatePhoneNumber, (req, res) => {
  const list = inbox.get(req.validatedFrom);
  if (!list || list.length === 0) {
    return res.status(404).json({ found: false, last: null, at: null, error: "No messages found for this number" });
  }
  const data = list[0];
  res.json({ found: true, last: data.last, at: data.at });
});

app.post("/consume-code", validatePhoneNumber, (req, res) => {
  const from = req.validatedFrom;
  const list = inbox.get(from);
  if (!list || list.length === 0) {
    return res.status(404).json({ ok: false, reason: "not_found", error: "No messages found for this number" });
  }
  const used = list.shift();
  if (list.length === 0) inbox.delete(from); else inbox.set(from, list);
  res.json({ ok: true, used });
});

// Estado del servidor
app.get("/status", (req, res) => {
  let totalMessages = 0;
  for (const [, messages] of inbox) totalMessages += messages.length;
  res.json({ status: "active", uniqueNumbers: inbox.size, totalMessages, uptime: process.uptime() });
});

// Probar extractor
app.post("/test-extract", (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: "Text parameter required" });
  const code = extractCode(text);
  res.json({ text, code });
});

// 404 y errores
app.use((req, res) => res.status(404).json({ error: "Endpoint not found" }));
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor optimizado escuchando en puerto ${PORT}`);
  console.log(`🔐 Verificación Twilio: ${process.env.TWILIO_AUTH_TOKEN ? "ACTIVADA" : "DESACTIVADA"}`);
});

