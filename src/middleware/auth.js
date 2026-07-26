function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Debe iniciar sesión' });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Debe iniciar sesión' });
    if (!roles.includes(req.session.user.rol)) return res.status(403).json({ error: 'Acceso no autorizado' });
    next();
  };
}
module.exports = { requireAuth, requireRole };
