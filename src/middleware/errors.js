function errors(err, req, res, next) {
  console.error(err);
  const status = err.status || (String(err.code || '').startsWith('SQLITE_CONSTRAINT') ? 400 : 500);
  const message = status === 500 ? 'Ocurrió un error interno' : err.message;
  res.status(status).json({ error: message });
}
module.exports = errors;
