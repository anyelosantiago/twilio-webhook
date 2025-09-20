// server.js
const express = require("express");
const app = express();

app.use(express.urlencoded({ extended: true }));

// Memoria simple por número
const inbox = Object.create(null);

// >>> EXTRACTOR OPTIMIZADO PARA GOOGLE <<<
function extractCode(text) {
  if (!text) return null;

  const t = text.trim();

  // 1) "G-123456"
  let m = t.match(/\bG\s*-\s*(\d{6})\b/i);
  if (m) return m[1];

  // 2) "Google ... 123456"
  m = t.match(/\bgoogle[^0-9]{0,40}(\d{6})\b/i);
  if (m) return m[1];

  // 3) "Google Voice/Gmail/YouTube ... 123456"
  m = t.match(/\b(google\s*voice|gmail|youtube|yt)[^0-9]{0,40}(\d{6})\b/i);
  if (m) return m[2];

  // 4) "Use/Your/Tu/Su ... 123456"
  m = t.match(/\b(?:use|your|tu|su)[^0-9]{0,20}(\d{6})\b/i);
  if (m) return m[1];

  // Evita teléfonos largos (7+ dígitos)
  const noPhones = t.replace(/\d{7,}/g, " ");

  // 5) Con separadores: "12 34 56", "12-34-56", "123 456"
  let sep = noPhones.match(/(?<!\d)(?:\d[ \-\.]?){6}(?!\d)/);
  if (sep) {
    const onlyDigits = sep[0].replace(/\D+/g, "");
    if (onlyDigits.length === 6) return onlyDigits;
  }

  // 6) Fallback: 6 dígitos
  m = noPhones.match(/\b(\d{6})\b/);
  if (m) return m[1];

  return null;
}

// Webhook de Twilio
app.post("/sms-webhook", (req, res) => {
  const from = (req.body.From || "").trim();  // +16316497614
  const body = (req.body.Body || "").trim();  // texto SMS
  const code = extractCode(body);

  if (from) {
    inbox[from] = { code: code || null, last: body, at: Date.now() };
    console.log(`[SMS] De: ${from} | Codigo: ${code || "N/A"} | Texto: ${body}`);
  }

  res.type("text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
});

// Leer código por número
// Ej: GET /get-code?from=%2B16316497614
app.get("/get-code", (req, res) => {
  const from = (req.query.from || "").trim();
  if (!from || !inbox[from]) {
    return res.json({ found: false, code: null, last: null, at: null });
  }
  const { code, last, at } = inbox[from];
  res.json({ found: !!code, code: code || null, last: last || null, at: at || null });
});

// (Opcional) Ver último texto aunque no tenga código
app.get("/get-last", (req, res) => {
  const from = (req.query.from || "").trim();
  if (!from || !inbox[from]) {
    return res.json({ found: false, last: null, at: null });
  }
  const { last, at } = inbox[from];
  res.json({ found: true, last, at });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor escuchando en puerto ${PORT}`);
});

