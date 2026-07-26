const bcrypt = require('bcryptjs');
const db = require('../config/database');
exports.login = (req, res) => {
  const { usuario, password } = req.body;
  const row = db.prepare(`SELECT u.*,r.nombre rol FROM usuarios u JOIN roles r ON r.id=u.rol_id
    WHERE u.usuario=? AND u.activo=1`).get(String(usuario || '').trim());
  if (!row || !bcrypt.compareSync(String(password || ''), row.password_hash))
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  req.session.user = { id: row.id, usuario: row.usuario, nombre: row.nombre, rol: row.rol };
  res.json(req.session.user);
};
exports.me = (req, res) => res.json(req.session.user || null);
exports.logout = (req, res, next) => req.session.destroy(err => err ? next(err) : res.json({ ok: true }));
