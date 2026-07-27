const db = require('../config/database');
const productSelect = `SELECT p.*,c.nombre categoria,m.nombre marca,
  CASE WHEN p.es_combo=1 THEN COALESCE((
    SELECT MIN(CAST(cp.stock/cd.cantidad AS INTEGER))
    FROM combo_detalle cd JOIN productos cp ON cp.id=cd.componente_producto_id
    WHERE cd.combo_producto_id=p.id AND cp.activo=1
  ),0) ELSE p.stock END stock_calculado,
  CASE WHEN p.es_combo=1 THEN COALESCE((
    SELECT SUM(cp.precio*cd.cantidad)
    FROM combo_detalle cd JOIN productos cp ON cp.id=cd.componente_producto_id
    WHERE cd.combo_producto_id=p.id
  ),0) ELSE p.precio END precio_original_calculado,
  CASE WHEN p.es_combo=1 THEN p.precio
    WHEN p.descuento_tipo<>'ninguno' AND p.descuento_valor>0
      AND (p.descuento_inicio IS NULL OR date(p.descuento_inicio)<=date('now','localtime'))
      AND (p.descuento_fin IS NULL OR date(p.descuento_fin)>=date('now','localtime'))
    THEN CASE p.descuento_tipo
      WHEN 'porcentaje' THEN MAX(0,ROUND(p.precio*(1-p.descuento_valor/100.0),2))
      WHEN 'fijo' THEN MAX(0,ROUND(p.precio-p.descuento_valor,2))
      ELSE p.precio END
    ELSE p.precio END precio_efectivo_calculado
  FROM productos p LEFT JOIN categorias c ON c.id=p.categoria_id LEFT JOIN marcas m ON m.id=p.marca_id`;
const normalize = row => {
  if(!row)return row;
  const precioOriginal=Number(row.precio_original_calculado||row.precio||0);
  const precioEfectivo=Number(row.precio_efectivo_calculado??row.precio??0);
  return {
    ...row,
    stock:row.stock_calculado,
    precio_base:Number(row.precio||0),
    precio_original:precioOriginal,
    precio:precioEfectivo,
    descuento_activo:precioEfectivo<precioOriginal,
    ahorro:Math.max(0,Math.round((precioOriginal-precioEfectivo)*100)/100),
    descuento_porcentaje:precioOriginal>0?Math.round((precioOriginal-precioEfectivo)/precioOriginal*100):0
  };
};
const Catalog = {
  products(q = '', activeOnly = false) {
    const where = [`(p.nombre LIKE ? OR p.codigo_interno LIKE ? OR p.codigo_barras LIKE ?)`];
    if (activeOnly) where.push('p.activo=1');
    return db.prepare(`${productSelect} WHERE ${where.join(' AND ')} ORDER BY p.nombre LIMIT 300`)
      .all(...Array(3).fill(`%${q}%`)).map(normalize);
  },
  product(id) { return normalize(db.prepare(`${productSelect} WHERE p.id=?`).get(id)); },
  byBarcode(code) { return normalize(db.prepare(`${productSelect} WHERE p.codigo_barras=? AND p.activo=1`).get(code)); },
  comboItems(id) { return db.prepare(`SELECT cd.componente_producto_id producto_id,cd.cantidad,p.nombre,p.stock,p.unidad,p.precio precio_original
    FROM combo_detalle cd JOIN productos p ON p.id=cd.componente_producto_id WHERE cd.combo_producto_id=? ORDER BY p.nombre`).all(id); },
  categories() { return db.prepare('SELECT * FROM categorias ORDER BY nombre').all(); },
  brands() { return db.prepare('SELECT * FROM marcas ORDER BY nombre').all(); },
  suppliers() { return db.prepare('SELECT * FROM proveedores ORDER BY razon_social').all(); }
};
module.exports = Catalog;
