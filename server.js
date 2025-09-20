// server.js — Banco global de SMS + compatibilidad por remitente + seguridad
const express = require("express");
const app = express();

// Middlewares
app.use(express.urlencoded({ extended: false })); // Twilio envía x-www-form-urlencoded
app.use(express.json());                          // También aceptamos JSON

// ===== Almacenamiento =====
// Por remitente (Map -> array con los últimos 5 mensajes por número)
const inbox = new Map();
// Global (array con todos los mensajes, máx N)
const GLOBAL_MAX = 500; // banco global cap
const globalInbox = []; // [{from, code, last, at}]

// TTL (tiempo de vida de un mensaje en memoria)
const MAX_STORAGE_TIME = 10 * 60 * 1000; // 10 minutos

// ===== Regex precompiladas (extraer código) =====
const REGEX_PATTERNS = {
  gFormat: /\bG\s*-\s*(\d{4,8})\b/i,
  googleCode: /\bgoogle[^0-9]{0,40}(\d{4,8})\b/i,
  googleServices: /\b(google\s*voice|gmail|youtube|yt)[^0-9]{0,40}(\d{4,8})\b/i,
  useYour: /\b(?:use|your|tu|su)[^0-9]{0,20}(\d{4,8})\b/i,
  separatedCode: /(?<!\d)(?:\d[ \-\.]?){4,8}(?!\d)/,
  digitsOnly: /\b(\d{4,8})\b/
};

// ===== Utilidades =====
function extractCode(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const t = text.trim();
  let match;

  if ((match = REGEX_PATTERNS.gFormat.exec(t))) return match[1];
  if ((match = REGEX_PATTERNS.googleCode.exec(t))) return match[1];
  if ((match = REGEX_PATTERNS.googleServices.exec(t))) return match[2];
  if ((match = REGEX_PATTERNS.useYour.exec(t))) return match[1];

  const noPhones = t.replace(/\d{9,}/g, " ");
  if ((match = REGEX_PATTERNS.separatedCode.exec(noPhones))) {
    const onlyDigits = match[0].replace(/\D+/g, "");
    if (onlyDigits.length >= 4 && onlyDigits.length <= 8) return onlyDigits;
  }
  if ((match = REGEX_PATTERNS.digitsOnly.exec(noPhones))) return match[1];

  return null;
}

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

// (Opcional) Verificación de firma Twilio si configuras TWILIO_AUTH_TOKEN
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

// ===== Limpieza periódica (TTL) =====
setInterval(() => {
  const now = Date.now();

  // Limpia por remitente
  for (const [from, list] of inbox.entries()) {
    if (!Array.isArray(list) || list.length === 0) {
      inbox.delete(from);
      continue;
    }
    const filtered = list.filter(item => now - item.at <= MAX_STORAGE_TIME);
    if (filtered.length) inbox.set(from, filtered.slice(0, 5));
    else inbox.delete(from);
  }

  // Limpia global
  for (let i = globalInbox.length - 1; i >= 0; i--) {
    if (now - globalInbox[i].at > MAX_STORAGE_TIME) {
      globalInbox.splice(i, 1);
    }
  }
}, 5 * 60 * 1000);

// ===== Webhook de Twilio (recibe SMS) =====
app.post("/sms-webhook", validateTwilioSignature, (req, res) => {
  const from = (req.body.From || "").trim(); // remitente (tu cel / el que envía)
  const body = (req.body.Body || "").trim(); // texto del SMS

  if (!from) {
    return res.type("text/xml").status(400)
      .send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Error: From required</Message></Response>`);
  }

  const code = extractCode(body);
  const at = Date.now();

  // Guarda por remitente
  if (!inbox.has(from)) inbox.set(from, []);
  const list = inbox.get(from);
  list.unshift({ code, last: body, at });
  inbox.set(from, list.slice(0, 5));

  // Guarda en GLOBAL (banco)
  globalInbox.unshift({ from, code, last: body, at });
  if (globalInbox.length > GLOBAL_MAX) globalInbox.pop();

  console.log(`[SMS] De: ${from} | Codigo: ${code || "N/A"} | Texto: ${body.substring(0, 80)}${body.length > 80 ? "..." : ""}`);

  res.type("text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
});

// ===== Rutas por remitente (ya existentes) =====
app.get("/get-code/:from", validatePhoneNumber, (req, res) => {
  const list = inbox.get(req.validatedFrom);
  if (!list || list.length === 0)
    return res.status(404).json({ found: false, code: null, last: null, at: null, error: "No messages found for this number" });
  const data = list[0];
  res.json({ found: !!data.code, code: data.code, last: data.last, at: data.at });
});

app.get("/get-last/:from", validatePhoneNumber, (req, res) => {
  const list = inbox.get(req.validatedFrom);
  if (!list || list.length === 0)
    return res.status(404).json({ found: false, last: null, at: null, error: "No messages found for this number" });
  const data = list[0];
  res.json({ found: true, last: data.last, at: data.at });
});

app.delete("/consume-code/:from", validatePhoneNumber, (req, res) => {
  const from = req.validatedFrom;
  const list = inbox.get(from);
  if (!list || list.length === 0)
    return res.status(404).json({ ok: false, reason: "not_found", error: "No messages found for this number" });
  const used = list.shift();
  if (list.length === 0) inbox.delete(from); else inbox.set(from, list);
  res.json({ ok: true, used });
});

// ===== Compatibilidad (legacy con ?from=) =====
app.get("/get-code", validatePhoneNumber, (req, res) => {
  const list = inbox.get(req.validatedFrom);
  if (!list || list.length === 0)
    return res.status(404).json({ found: false, code: null, last: null, at: null, error: "No messages found for this number" });
  const data = list[0];
  res.json({ found: !!data.code, code: data.code, last: data.last, at: data.at });
});

app.get("/get-last", validatePhoneNumber, (req, res) => {
  const list = inbox.get(req.validatedFrom);
  if (!list || list.length === 0)
    return res.status(404).json({ found: false, last: null, at: null, error: "No messages found for this number" });
  const data = list[0];
  res.json({ found: true, last: data.last, at: data.at });
});

app.post("/consume-code", validatePhoneNumber, (req, res) => {
  const from = req.validatedFrom;
  const list = inbox.get(from);
  if (!list || list.length === 0)
    return res.status(404).json({ ok: false, reason: "not_found", error: "No messages found for this number" });
  const used = list.shift();
  if (list.length === 0) inbox.delete(from); else inbox.set(from, list);
  res.json({ ok: true, used });
});

// ===== NUEVOS ENDPOINTS GLOBALES (banco único) =====

// Lista global (con filtros)
// GET /inbox?limit=50&withCode=true&sinceMinutes=30&q=google
app.get("/inbox", (req, res) => {
  let { limit = 50, withCode, sinceMinutes, q } = req.query;
  limit = Math.max(1, Math.min(parseInt(limit || 50, 10), GLOBAL_MAX));

  const now = Date.now();
  let items = globalInbox.slice(); // copia

  if (sinceMinutes) {
    const ms = Math.max(0, parseInt(sinceMinutes, 10)) * 60 * 1000;
    items = items.filter(it => now - it.at <= ms);
  }
  if (withCode === "true") {
    items = items.filter(it => !!it.code);
  } else if (withCode === "false") {
    items = items.filter(it => !it.code);
  }
  if (q && typeof q === "string") {
    const needle = q.toLowerCase();
    items = items.filter(it =>
      (it.last && it.last.toLowerCase().includes(needle)) ||
      (it.from && it.from.toLowerCase().includes(needle))
    );
  }

  res.json({
    count: Math.min(items.length, limit),
    items: items.slice(0, limit)
  });
});

// Último mensaje global
app.get("/inbox/latest", (req, res) => {
  if (globalInbox.length === 0) return res.json({ found: false, item: null });
  res.json({ found: true, item: globalInbox[0] });
});

// Último código global (de cualquier remitente)
app.get("/inbox/latest-code", (req, res) => {
  const found = globalInbox.find(it => !!it.code);
  if (!found) return res.json({ found: false, code: null, item: null });
  res.json({ found: true, code: found.code, item: found });
});

// Consumir el último código global
app.delete("/inbox/consume-latest-code", (req, res) => {
  const idx = globalInbox.findIndex(it => !!it.code);
  if (idx < 0) return res.status(404).json({ ok: false, reason: "no_code" });
  const used = globalInbox[idx];
  // También lo removemos del inbox por remitente si coincide
  const list = inbox.get(used.from);
  if (list && list.length) {
    const localIdx = list.findIndex(m => m.at === used.at && m.last === used.last);
    if (localIdx >= 0) {
      list.splice(localIdx, 1);
      if (list.length === 0) inbox.delete(used.from); else inbox.set(used.from, list);
    }
  }
  globalInbox.splice(idx, 1);
  res.json({ ok: true, used });
});

// ===== Estado y ayudas =====
app.get("/status", (req, res) => {
  let totalMessages = globalInbox.length;
  res.json({
    status: "active",
    uniqueNumbers: inbox.size,
    totalMessages,
    uptime: process.uptime()
  });
});

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
