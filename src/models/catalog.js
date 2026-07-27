const db = require('../config/database');
const productSelect = `SELECT p.*,c.nombre categoria,m.nombre marca,
  CASE WHEN p.es_combo=1 THEN COALESCE((
    SELECT MIN(CAST(cp.stock/cd.cantidad AS INTEGER))
    FROM combo_detalle cd JOIN productos cp ON cp.id=cd.componente_producto_id
    WHERE cd.combo_producto_id=p.id AND cp.activo=1
  ),0) ELSE p.stock END stock_calculado
  FROM productos p LEFT JOIN categorias c ON c.id=p.categoria_id LEFT JOIN marcas m ON m.id=p.marca_id`;
const normalize = row => row ? { ...row, stock: row.stock_calculado } : row;
const Catalog = {
  products(q = '', activeOnly = false) {
    const where = [`(p.nombre LIKE ? OR p.codigo_interno LIKE ? OR p.codigo_barras LIKE ?)`];
    if (activeOnly) where.push('p.activo=1');
    return db.prepare(`${productSelect} WHERE ${where.join(' AND ')} ORDER BY p.nombre LIMIT 300`)
      .all(...Array(3).fill(`%${q}%`)).map(normalize);
  },
  product(id) { return normalize(db.prepare(`${productSelect} WHERE p.id=?`).get(id)); },
  byBarcode(code) { return normalize(db.prepare(`${productSelect} WHERE p.codigo_barras=? AND p.activo=1`).get(code)); },
  comboItems(id) { return db.prepare(`SELECT cd.componente_producto_id producto_id,cd.cantidad,p.nombre,p.stock,p.unidad
    FROM combo_detalle cd JOIN productos p ON p.id=cd.componente_producto_id WHERE cd.combo_producto_id=? ORDER BY p.nombre`).all(id); },
  categories() { return db.prepare('SELECT * FROM categorias ORDER BY nombre').all(); },
  brands() { return db.prepare('SELECT * FROM marcas ORDER BY nombre').all(); },
  suppliers() { return db.prepare('SELECT * FROM proveedores ORDER BY razon_social').all(); }
};
module.exports = Catalog;
