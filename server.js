// server.js (UNIFICADO) - incluye mapeo ampliado de horas_extras y genero
require('dotenv').config();
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason, p) => {
  console.error('UNHANDLED REJECTION at', p, 'reason:', reason && (reason.stack || reason));
});

const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;
const DEBUG = process.env.DEBUG === 'true' || false;

// ------------------------------
// DB pool
// ------------------------------
const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONN_LIMIT || "10", 10),
  queueLimit: 0,
  ssl: { rejectUnauthorized: false }
};
console.log("RAILWAY DB CONFIG ->", {
  DB_HOST: process.env.DB_HOST,
  DB_PORT: process.env.DB_PORT,
  DB_USER: process.env.DB_USER,
  DB_NAME: process.env.DB_NAME
});
const pool = mysql.createPool(dbConfig);


// ------------------------------
// Middleware
// ------------------------------
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: process.env.EXPRESS_JSON_LIMIT || '20mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.EXPRESS_URLENCODED_LIMIT || '20mb' }));

let sessionStore;
try {
  const MySQLStore = require('express-mysql-session')(session);

  const sessionStoreOptions = {
    host: dbConfig.host,
    port: dbConfig.port || parseInt(process.env.DB_PORT || "16015", 10),
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    createDatabaseTable: true,
    schema: {
      tableName: 'sessions',
      columnNames: {
        session_id: 'session_id',
        expires: 'expires',
        data: 'data'
      }
    }
  };

  sessionStore = new MySQLStore(sessionStoreOptions);
  console.log('Session store inicializada (MySQL).');
} catch (err) {
  console.error('WARNING: No se pudo inicializar MySQL session store, usando MemoryStore como fallback. Error:', err && (err.stack || err));
  // Fallback: no pasar store (usa MemoryStore, no recomendado en prod pero evita crash)
  sessionStore = null;
}

app.set('trust proxy', 1); // confía en el proxy (Railway/Heroku/NGINX)
app.use(session({
  name: 'prp_sid',
  secret: process.env.SESSION_SECRET || 'clave_segura',
  store: sessionStore || undefined,   // tu MySQLStore si está inicializado
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,    // 1 día
    secure: process.env.NODE_ENV === 'production', // true en prod con HTTPS real
    httpOnly: true,
    sameSite: 'lax'                 // 'lax' suele ser lo más compatible para login/redirect
  }
}));






// ------------------------------
// Uploads (multer)
// ------------------------------
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;
    cb(null, safe);
  }
});
const upload = multer({ storage });

// ------------------------------
// Defaults & helpers
// ------------------------------
const DEFAULT_TEXT = "Vacio-Nada";
const DEFAULT_NUM = 0;
const DEFAULT_DATE = "1900-01-01";

function flattenValues(values) {
  if (Array.prototype.flat) return values.flat();
  return values.reduce((acc, v) => acc.concat(v), []);
}

function colsPlaceholder(cols) {
  return cols.map(_ => "?").join(",");
}

function sanitizeIncomingValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === "" || ["nan", "none", "null", "n/a", "vacio-nada"].includes(s.toLowerCase())) return null;
    return s;
  }
  if (typeof v === 'number') {
    if (!isFinite(v)) return null;
    return v;
  }
  return v;
}

// Normalize + validate one employee object from client
function normalizeEmployee(raw) {
  const emp = {};
  let others = (raw && raw.otros && typeof raw.otros === 'object') ? { ...raw.otros } : {};
  const autofilled = [];

  function setTextField(key, candidates) {
    let v = null;
    for (const c of candidates) {
      if (raw && raw[c] !== undefined) { v = raw[c]; break; }
      // try normalized keys
      if (raw) {
        const found = Object.keys(raw).find(k => String(k).toLowerCase().replace(/\s+/g, '_') === c);
        if (found) { v = raw[found]; break; }
      }
    }
    v = sanitizeIncomingValue(v);
    if (v === null || v === undefined) {
      emp[key] = DEFAULT_TEXT;
      autofilled.push(key);
    } else emp[key] = String(v);
  }

  function setNumField(key, candidates) {
    let v = null;
    for (const c of candidates) {
      if (raw && raw[c] !== undefined) { v = raw[c]; break; }
      if (raw) {
        const found = Object.keys(raw).find(k => String(k).toLowerCase().replace(/\s+/g, '_') === c);
        if (found) { v = raw[found]; break; }
      }
    }
    v = sanitizeIncomingValue(v);
    if (v === null || v === undefined) {
      emp[key] = DEFAULT_NUM;
      autofilled.push(key);
    } else {
      const n = Number(v);
      emp[key] = isFinite(n) ? n : DEFAULT_NUM;
      if (!isFinite(n)) autofilled.push(key);
    }
  }

  // employee_id detection
  let empId = sanitizeIncomingValue(raw && (raw.employee_id || raw.id || raw.Id || raw.id_empleado || raw.codigo || raw.dni || raw.dui || raw.legajo));
  if (!empId && raw) {
    for (const k of Object.keys(raw)) {
      const lk = String(k).toLowerCase();
      if ((lk.includes("id") || lk.includes("codigo") || lk.includes("dni") || lk.includes("dui") || lk.includes("legajo") || lk.includes("numero")) && String(raw[k]).trim() !== "") {
        empId = sanitizeIncomingValue(raw[k]);
        break;
      }
    }
  }
  if (!empId) {
    empId = `srv_${Math.random().toString(36).slice(2, 12)}`;
    autofilled.push("employee_id");
    try { others._generated_employee_id = true; } catch (e) { }
  }
  emp.employee_id = String(empId);

  // nombre
  let nombre = sanitizeIncomingValue(raw && (raw.nombre || raw.name || raw.Nombres || raw.nombres || raw.full_name));
  if (!nombre) {
    emp.nombre = DEFAULT_TEXT;
    autofilled.push("nombre");
    try { others._generated_nombre = true; } catch (e) { }
  } else emp.nombre = String(nombre);

  // genero (aliases)
  let gen = null;
  if (raw) {
    const cand = ["genero", "sexo", "gender", "sex"];
    for (const c of cand) {
      if (raw[c] !== undefined && String(raw[c]).trim() !== "") {
        gen = String(raw[c]).trim();
        break;
      }
      const found = Object.keys(raw).find(k => String(k).toLowerCase().replace(/\s+/g, '_') === c);
      if (found) { gen = raw[found]; break; }
    }
  }
  if (!gen || String(gen).trim() === "") {
    emp.genero = "No declarado";
    autofilled.push("genero");
  } else {
    const gl = String(gen).toLowerCase();
    if (gl.startsWith('f') || gl.includes('femen') || gl.includes('female')) emp.genero = "Femenino";
    else if (gl.startsWith('m') || gl.includes('masc') || gl.includes('male')) emp.genero = "Masculino";
    else emp.genero = "Otro";
  }

  // departamento
  setTextField("departamento", ["departamento", "dept", "area", "department", "division"]);

  // fecha_ingreso
  let fecha = sanitizeIncomingValue(raw && (raw.fecha_ingreso || raw.start_date || raw.fechaInicio));
  if (!fecha) {
    emp.fecha_ingreso = DEFAULT_DATE;
    autofilled.push("fecha_ingreso");
  } else emp.fecha_ingreso = String(fecha);

  // numeric fields
  setNumField("antiguedad_meses", ["antiguedad_meses", "antiguedad", "años_trabaja", "años_enla_empr", "años_enel"]);

  // SALARIO
  let salarioRaw = null;
  if (raw && raw.salario !== undefined) salarioRaw = raw.salario;
  else if (raw && raw.ingresos_mensuales !== undefined) salarioRaw = raw.ingresos_mensuales;
  else if (raw && raw.salario_por_hora !== undefined) salarioRaw = raw.salario_por_hora;
  let salarioVal = null;
  if (salarioRaw !== null && salarioRaw !== undefined && String(salarioRaw).trim() !== "") {
    try {
      const s = String(salarioRaw).replace(",", ".").trim();
      if (/(por_hora|hora|\/h|h\/|hour)/i.test(s)) {
        const m = s.match(/([0-9]+(?:\.[0-9]+)?)/);
        if (m) salarioVal = Math.round(parseFloat(m[1]) * 160 * 100) / 100;
      } else {
        const m = s.match(/([0-9]+(?:\.[0-9]+)?)/);
        if (m) salarioVal = Math.round(parseFloat(m[1]) * 100) / 100;
      }
    } catch (e) { salarioVal = null; }
  }
  emp.salario = (salarioVal !== null && salarioVal !== undefined && isFinite(Number(salarioVal))) ? Number(salarioVal) : DEFAULT_NUM;
  if (salarioVal === null) autofilled.push("salario");

  // satisfaccion
  let satVal = sanitizeIncomingValue(raw && (raw.satisfaccion || raw.satisfaccion_conel_entorno || raw.sastisfacion_laboral || raw.satisfaccion_laboral || raw.satisfaction));
  if (satVal === null || satVal === undefined || String(satVal).trim() === "") {
    emp.satisfaccion = DEFAULT_NUM;
    autofilled.push("satisfaccion");
  } else {
    const n = Number(String(satVal).replace(",", "."));
    emp.satisfaccion = isFinite(n) ? n : DEFAULT_NUM;
    if (!isFinite(n)) autofilled.push("satisfaccion");
  }

  // ingresos_mensuales - if present use, else try salario
  let ingVal = sanitizeIncomingValue(raw && (raw.ingresos_mensuales || raw.ingresos || raw.income));
  if (ingVal === null || ingVal === undefined || String(ingVal).trim() === "") {
    emp.ingresos_mensuales = emp.salario || DEFAULT_NUM;
    if (emp.ingresos_mensuales === DEFAULT_NUM) autofilled.push("ingresos_mensuales");
  } else {
    const n = Number(String(ingVal).replace(",", "."));
    emp.ingresos_mensuales = isFinite(n) ? n : DEFAULT_NUM;
    if (!isFinite(n)) autofilled.push("ingresos_mensuales");
  }

  // HORAS_EXTRAS (aliases ampliados)
  let hrs = null;
  if (raw) {
    const candidates = ["horas_extras", "horas", "extra_hours", "extra_hours_worked", "overtime", "overtime_hours", "hrs_extra"];
    for (const c of candidates) {
      if (raw[c] !== undefined && String(raw[c]).trim() !== "") {
        hrs = raw[c];
        break;
      }
      const lc = Object.keys(raw).find(k => String(k).toLowerCase().replace(/\s+/g, '_') === c);
      if (lc) { hrs = raw[lc]; break; }
    }
  }
  if (hrs === null || hrs === undefined || String(hrs).trim() === "") {
    emp.horas_extras = DEFAULT_NUM;
    autofilled.push("horas_extras");
  } else {
    const n = Number(String(hrs).replace(",", "."));
    emp.horas_extras = isFinite(n) ? n : DEFAULT_NUM;
    if (!isFinite(n)) autofilled.push("horas_extras");
  }

  // puesto, rol_del_puesto
  setTextField("puesto", ["puesto", "position", "cargo", "rol_del_puesto", "rol"]);
  setTextField("rol_del_puesto", ["rol_del_puesto", "role", "rol"]);

  // edad
  let edad = sanitizeIncomingValue(raw && (raw.edad || raw.age));
  if (edad === null || edad === undefined || String(edad).trim() === "") {
    emp.edad = DEFAULT_NUM;
    autofilled.push("edad");
  } else {
    const n = Number(String(edad).replace(",", "."));
    emp.edad = isFinite(n) ? n : DEFAULT_NUM;
    if (!isFinite(n)) autofilled.push("edad");
  }

  // created/updated timestamps
  const nowts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  emp.creado_at = raw && raw.creado_at ? String(raw.creado_at) : nowts;
  emp.actualizado_at = raw && raw.actualizado_at ? String(raw.actualizado_at) : emp.creado_at;

  // build 'otros'
  if (raw && raw.otros && typeof raw.otros === 'object') {
    others = { ...others, ...raw.otros };
  } else if (raw && raw.otros && typeof raw.otros === 'string') {
    try {
      const parsed = JSON.parse(raw.otros);
      if (typeof parsed === 'object') others = { ...others, ...parsed };
      else others._otros_raw = raw.otros;
    } catch (e) {
      others._otros_raw = raw.otros;
    }
  }

  others._fields_autofilled = autofilled;
  emp.otros = JSON.stringify(others);

  return { emp, autofilled_count: autofilled.length, autofields: autofilled };
}

// ------------------------------
// ROUTES: login / session (original behavior)
// ------------------------------
app.post('/login', async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) return res.status(400).send({ ok: false, msg: 'Faltan datos' });

  let connection;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.execute('SELECT id, usuario, password_hash, nombre FROM usuarios WHERE usuario = ?', [usuario]);
    if (rows.length === 0) return res.status(401).send({ ok: false, msg: 'Usuario o contraseña incorrectos' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).send({ ok: false, msg: 'Usuario o contraseña incorrectos' });

    req.session.user = { id: user.id, usuario: user.usuario, nombre: user.nombre };
    return res.send({ ok: true });
  } catch (err) {
    console.error("LOGIN ERROR:", err && err.stack ? err.stack : err);
    return res.status(500).send({ ok: false, msg: 'Error del servidor' });
  } finally {
    if (connection) connection.release();
  }
});

app.get('/session-info', (req, res) => {
  if (req.session && req.session.user) return res.send({ logged: true, user: req.session.user });
  return res.send({ logged: false });
});

function requiereLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/Login.html');
}

app.get('/Inicio.html', requiereLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'Inicio.html'));
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.send({ ok: true }));
});

// ------------------------------
// Upload endpoints (modificado para mostrar mensaje al usuario)
// ------------------------------
app.post('/upload', requiereLogin, upload.array('files', 10), async (req, res) => {
  const files = req.files;

  // ⭐ MODIFICACIÓN: mensaje claro si no se envían archivos
  if (!files || files.length === 0) {
    return res.status(400).json({
      ok: false,
      msg: 'No se recibieron archivos. Seleccione un archivo e inténtelo de nuevo.'
    });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const inserted = [];
    for (const f of files) {
      const filename = f.originalname;
      const mimetype = f.mimetype;
      const size = f.size;
      const file_path = f.path;

      const [result] = await conn.query(
        `INSERT INTO uploads (filename, mimetype, size, file_path, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        [filename, mimetype, size, file_path]
      );

      inserted.push({
        id: result.insertId,
        filename,
        file_path,
        size
      });
    }

    await conn.commit();

    // ⭐ MODIFICACIÓN: mensaje de éxito para el usuario
    return res.status(200).json({
      ok: true,
      msg: 'Archivo(s) cargado(s) correctamente.',
      files: inserted
    });
  } catch (err) {
    if (conn) await conn.rollback();

    console.error('Error al insertar uploads:', err && err.stack ? err.stack : err);

    // ⭐ MODIFICACIÓN: mensaje claro de error para el usuario
    return res.status(500).json({
      ok: false,
      msg: 'Error guardando archivos en el servidor. Contacte con soporte.',
      detail: String(err).slice(0, 200)  // opcional para debugging
    });
  } finally {
    if (conn) conn.release();
  }
});


app.get('/uploads', requiereLogin, async (req, res) => {
  const { status } = req.query;
  try {
    let sql = 'SELECT id, filename, size, file_path, uploaded_at, status, notes FROM uploads';
    const params = [];
    if (status) { sql += ' WHERE status = ?'; params.push(status); }
    sql += ' ORDER BY uploaded_at DESC LIMIT 500';
    const [rows] = await pool.query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, msg: err.message });
  }
});

app.get('/download/:id', requiereLogin, async (req, res) => {
  const id = req.params.id;
  try {
    const [rows] = await pool.query('SELECT filename, file_path FROM uploads WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).send('No encontrado');
    const row = rows[0];
    if (row.file_path && fs.existsSync(row.file_path)) return res.download(row.file_path, row.filename);
    else return res.status(404).send('Archivo no disponible en el servidor');
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return res.status(500).send(err.message);
  }
});

app.post('/uploads/:id/status', requiereLogin, async (req, res) => {
  const id = req.params.id;
  const status = req.body.status;
  const notes = req.body.notes || null;
  if (!['pending', 'processing', 'done', 'error'].includes(status)) return res.status(400).json({ ok: false, msg: 'status inválido' });

  try {
    await pool.query('UPDATE uploads SET status = ?, notes = ? WHERE id = ?', [status, notes, id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, msg: err.message });
  }
});

// ------------------------------
// Root redirect
// ------------------------------
app.get('/', (req, res) => res.redirect('/Login.html'));

// ------------------------------
// Endpoint: /api/empleados_raw/bulk (unified + validated)
// ------------------------------
app.post("/api/empleados_raw/bulk", async (req, res) => {
  const empleados = Array.isArray(req.body.empleados) ? req.body.empleados : (Array.isArray(req.body) ? req.body : []);
  if (!Array.isArray(empleados)) return res.status(400).json({ error: "'empleados' debe ser un array" });

  let connection;
  const summary = { total: empleados.length, inserted: 0, autofilled_total: 0, details: [] };

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // define fixed column order for insert (incluye genero)
    const cols = ["employee_id", "nombre", "genero", "departamento", "fecha_ingreso", "antiguedad_meses", "salario", "satisfaccion", "ingresos_mensuales", "horas_extras", "puesto", "rol_del_puesto", "otros", "creado_at", "actualizado_at", "edad"];

    const CHUNK = parseInt(process.env.EMP_INSERT_CHUNK || "400", 10);

    for (let i = 0; i < empleados.length; i += CHUNK) {
      const chunk = empleados.slice(i, i + CHUNK);
      const valuesList = [];
      for (const raw of chunk) {
        const { emp, autofilled_count, autofields } = normalizeEmployee(raw);
        summary.autofilled_total += autofilled_count;
        if (autofilled_count > 0) summary.details.push({ employee_id: emp.employee_id, autofields });

        const vals = cols.map(c => (emp[c] === undefined ? null : emp[c]));
        valuesList.push(vals);
      }

      if (valuesList.length === 0) continue;

      const placeholders = valuesList.map(_ => "(" + colsPlaceholder(cols) + ")").join(",");
      const sql = `INSERT INTO empleados_raw (${cols.join(",")}) VALUES ${placeholders}
                   ON DUPLICATE KEY UPDATE
                     nombre = VALUES(nombre),
                     genero = VALUES(genero),
                     departamento = VALUES(departamento),
                     fecha_ingreso = VALUES(fecha_ingreso),
                     antiguedad_meses = VALUES(antiguedad_meses),
                     salario = VALUES(salario),
                     satisfaccion = VALUES(satisfaccion),
                     ingresos_mensuales = VALUES(ingresos_mensuales),
                     horas_extras = VALUES(horas_extras),
                     puesto = VALUES(puesto),
                     rol_del_puesto = VALUES(rol_del_puesto),
                     otros = VALUES(otros),
                     actualizado_at = CURRENT_TIMESTAMP()`;

      const flat = flattenValues(valuesList);
      await connection.query(sql, flat);
      summary.inserted += valuesList.length;
    }

    await connection.commit();
    return res.json({ ok: true, summary });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("ERROR /api/empleados_raw/bulk:", err && err.stack ? err.stack : err);
    const resp = { ok: false, error: String(err) };
    if (DEBUG && err && err.stack) resp.stack = err.stack.split('\n').slice(0, 10);
    return res.status(500).json(resp);
  } finally {
    if (connection) connection.release();
  }
});

// ------------------------------
// Endpoint: /api/predictions/bulk (unchanged behavior, robust chunking)
// ------------------------------
app.post("/api/predictions/bulk", async (req, res) => {
  let preds = [];
  if (Array.isArray(req.body.predictions)) preds = req.body.predictions;
  else if (Array.isArray(req.body)) preds = req.body;
  else if (req.body && typeof req.body === 'object' && Array.isArray(req.body.data)) preds = req.body.data;

  if (!Array.isArray(preds)) return res.status(400).json({ error: "'predictions' debe ser un array" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const CHUNK = parseInt(process.env.PRED_INSERT_CHUNK || "500", 10);

    for (let i = 0; i < preds.length; i += CHUNK) {
      const chunk = preds.slice(i, i + CHUNK);

      const values = chunk.map(p => {
        const employee_id = p.employee_id ? String(p.employee_id) : null;
        const nombre = p.nombre || p.name || null;
        const departamento = p.departamento || p.dept || null;
        const fecha_ingreso = p.fecha_ingreso || null;
        const antiguedad_meses = p.antiguedad_meses != null ? p.antiguedad_meses : null;
        const salario = p.salario != null ? p.salario : null;
        const satisfaccion = p.satisfaccion != null ? p.satisfaccion : null;
        const prediccion = (p.prediccion !== undefined && p.prediccion !== null) ? Number(p.prediccion) : null;
        const probabilidad = (p.probabilidad !== undefined && p.probabilidad !== null) ? Number(p.probabilidad) : null;
        return [employee_id, nombre, departamento, fecha_ingreso, antiguedad_meses, salario, satisfaccion, prediccion, probabilidad];
      });

      const placeholders = values.map(_ => "(?,?,?,?,?,?,?,?,?)").join(",");
      const flat = flattenValues(values);

      const sql = `INSERT INTO empleado_prediccion
        (employee_id,nombre,departamento,fecha_ingreso,antiguedad_meses,salario,satisfaccion,prediccion,probabilidad)
        VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
           nombre = VALUES(nombre),
           departamento = VALUES(departamento),
           fecha_ingreso = VALUES(fecha_ingreso),
           antiguedad_meses = VALUES(antiguedad_meses),
           salario = VALUES(salario),
           satisfaccion = VALUES(satisfaccion),
           prediccion = VALUES(prediccion),
           probabilidad = VALUES(probabilidad),
           actualizado_at = CURRENT_TIMESTAMP()
      `;
      await connection.query(sql, flat);
    }

    await connection.commit();
    return res.json({ ok: true, inserted: preds.length });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("ERROR /api/predictions/bulk:", err && err.stack ? err.stack : err);
    const resp = { ok: false, error: String(err) };
    if (DEBUG && err && err.stack) resp.stack = err.stack.split('\n').slice(0, 10);
    return res.status(500).json(resp);
  } finally {
    if (connection) connection.release();
  }
});

// --- INICIO: endpoint para Contacto (añadir en server.js) ---
const nodemailer = require('nodemailer'); // agregar arriba si no está

// Crea el transporter usando variables de entorno (configurar en Railway)
const smtpHost = process.env.SMTP_HOST;   // ej. smtp.sendgrid.net o smtp.gmail.com
const smtpPort = process.env.SMTP_PORT || 587;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const toEmail = process.env.TO_EMAIL || 'cihuatadatalab@gmail.com';
const fromEmail = process.env.FROM_EMAIL || `no-reply@${process.env.DOMAIN || 'example.com'}`;

let mailerTransporter = null;
if (smtpHost && smtpUser && smtpPass) {
  mailerTransporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(smtpPort),
    secure: Number(smtpPort) === 465,
    auth: { user: smtpUser, pass: smtpPass }
  });
} else {
  console.warn('SMTP no configurado. Set SMTP_HOST, SMTP_USER, SMTP_PASS en variables de entorno.');
}

app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body || {};
    if (!message || !email) return res.status(400).json({ ok: false, error: 'Faltan campos' });

    if (!mailerTransporter) {
      return res.status(500).json({ ok: false, error: 'SMTP no configurado' });
    }

    const mailOptions = {
      from: `${name || 'Contacto web'} <${fromEmail}>`,
      to: toEmail,
      subject: subject || 'Nuevo contacto desde la web',
      text: `De: ${name || 'sin nombre'} <${email}>\n\n${message}`
    };

    await mailerTransporter.sendMail(mailOptions);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Error /api/contact:', err && (err.stack || err));
    return res.status(500).json({ ok: false, error: String(err).slice(0, 200) });
  }
});
// --- FIN: endpoint para Contacto ---

// ---------------------------------------------------
// GLOBAL ERROR HANDLERS (AGREGAR ESTO)
// ---------------------------------------------------
process.on('uncaughtException', err => {
  console.error('UNCAUGHT EXCEPTION', err);
});

process.on('unhandledRejection', err => {
  console.error('UNHANDLED REJECTION', err);
});
// ------------------------------
// Start
// ------------------------------
app.get('/health', (req, res) => res.send('OK'));


// ... otras rutas/middleware arriba ...

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://0.0.0.0:${PORT} (env PORT=${process.env.PORT})`);
});

