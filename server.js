// server.js
const express = require("express");
const app = express();

// Twilio envía x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));

// Memoria simple (para producción usa una BD)
const inbox = Object.create(null);

// Extrae el primer código de 6 dígitos del SMS
function extractCode(text) {
  if (!text) return null;

  const t = text.trim();

  // 1) Formato típico de Google: "G-123456"
  let m = t.match(/\bG\s*-\s*(\d{6})\b/i);
  if (m) return m[1];

  // 2) "Google ... 123456" (Google verification code...)
  m = t.match(/\bgoogle[^0-9]{0,40}(\d{6})\b/i);
  if (m) return m[1];

  // 3) "Google Voice/Gmail/YouTube ... 123456"
  m = t.match(/\b(google\s*voice|gmail|youtube|yt)[^0-9]{0,40}(\d{6})\b/i);
  if (m) return m[2];

  // 4) "Use/Your/Tu/Su ... 123456"
  m = t.match(/\b(?:use|your|tu|su)[^0-9]{0,20}(\d{6})\b/i);
  if (m) return m[1];

  // Evitar teléfonos largos (7+ dígitos)
  const noPhones = t.replace(/\d{7,}/g, " ");

  // 5) Códigos con separadores: "12 34 56", "12-34-56", "123 456"
  let sep = noPhones.match(/(?<!\d)(?:\d[ \-\.]?){6}(?!\d)/);
  if (sep) {
    const onlyDigits = sep[0].replace(/\D+/g, "");
    if (onlyDigits.length === 6) return onlyDigits;
  }

  // 6) Fallback: 6 dígitos sueltos
  m = noPhones.match(/\b(\d{6})\b/);
  if (m) return m[1];

  return null;
}


// Webhook para SMS entrante
app.post("/sms-webhook", (req, res) => {
  const from = (req.body.From || "").trim(); // +16316497614
  const body = (req.body.Body || "").trim(); // texto del SMS
  const code = extractCode(body);

  if (from) {
    inbox[from] = { code: code || null, last: body, at: Date.now() };
    console.log(`[SMS] De: ${from} | Codigo: ${code || "N/A"} | Texto: ${body}`);
  }

  // Responder TwiML vacío para Twilio
  res.type("text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
});

// Consultar código por número
// Ejemplo: GET /get-code?from=%2B16316497614
app.get("/get-code", (req, res) => {
  const from = (req.query.from || "").trim();
  if (!from || !inbox[from]) {
    return res.json({ found: false, code: null, last: null, at: null });
  }
  const { code, last, at } = inbox[from];
  res.json({ found: !!code, code: code || null, last: last || null, at: at || null });
});

// Consumir/borrar (opcional):
// POST /consume-code  (Body: from=+16316497614)
app.post("/consume-code", express.urlencoded({ extended: true }), (req, res) => {
  const from = (req.body.from || "").trim();
  if (from && inbox[from]) {
    const used = inbox[from];
    delete inbox[from];
    return res.json({ ok: true, used });
  }
  res.json({ ok: false, reason: "not_found" });
});

// IMPORTANTE en Railway: usar el puerto que da la plataforma
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor escuchando en puerto ${PORT}`);
});
