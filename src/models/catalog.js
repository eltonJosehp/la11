const db = require('../config/database');
const Catalog = {
  products(q = '', activeOnly = false) {
    const where = [`(p.nombre LIKE ? OR p.codigo_interno LIKE ? OR p.codigo_barras LIKE ?)`];
    if (activeOnly) where.push('p.activo=1');
    return db.prepare(`SELECT p.*,c.nombre categoria,m.nombre marca FROM productos p
      LEFT JOIN categorias c ON c.id=p.categoria_id LEFT JOIN marcas m ON m.id=p.marca_id
      WHERE ${where.join(' AND ')} ORDER BY p.nombre LIMIT 200`).all(...Array(3).fill(`%${q}%`));
  },
  product(id) { return db.prepare('SELECT * FROM productos WHERE id=?').get(id); },
  byBarcode(code) { return db.prepare('SELECT * FROM productos WHERE codigo_barras=? AND activo=1').get(code); },
  categories() { return db.prepare('SELECT * FROM categorias ORDER BY nombre').all(); },
  brands() { return db.prepare('SELECT * FROM marcas ORDER BY nombre').all(); },
  suppliers() { return db.prepare('SELECT * FROM proveedores ORDER BY razon_social').all(); }
};
module.exports = Catalog;
