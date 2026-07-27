const db = require('../config/database');
const Catalog = require('../models/catalog');
const bad = msg => Object.assign(new Error(msg), { status: 400 });
const visibleProduct = (product,role) => {
  if(role!=='vendedor') return product;
  const { costo, ...visible }=product;
  return visible;
};
exports.list = (req, res) => res.json(Catalog.products(req.query.q || '', req.query.active === '1').map(product=>visibleProduct(product,req.session.user.rol)));
exports.barcode = (req, res) => {
  const p = Catalog.byBarcode(req.params.code);
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json(visibleProduct(p,req.session.user.rol));
};
exports.save = (req, res) => {
  const b = req.body;
  if (!b.codigo_interno?.trim() || !b.nombre?.trim() || Number(b.precio) < 0) throw bad('Código, nombre y precio válidos son obligatorios');
  const info = db.prepare(`INSERT INTO productos(codigo_interno,codigo_barras,nombre,categoria_id,marca_id,descripcion,costo,precio,stock_minimo,unidad,vencimiento,es_combo)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.codigo_interno.trim(), b.codigo_barras?.trim() || null, b.nombre.trim(),
    b.categoria_id || null, b.marca_id || null, b.descripcion || null, Number(b.costo || 0), Number(b.precio),
    Number(b.stock_minimo || 0), b.unidad || 'unidad', b.vencimiento || null, b.es_combo === true || b.es_combo === '1' ? 1 : 0);
  res.status(201).json(Catalog.product(info.lastInsertRowid));
};
exports.update = (req, res) => {
  const old = Catalog.product(req.params.id);
  if (!old) return res.status(404).json({ error: 'Producto no encontrado' });
  const b = req.body, costo = Number(b.costo), precio = Number(b.precio);
  db.transaction(() => {
    db.prepare(`UPDATE productos SET codigo_interno=?,codigo_barras=?,nombre=?,categoria_id=?,marca_id=?,descripcion=?,
      costo=?,precio=?,stock_minimo=?,unidad=?,vencimiento=?,activo=?,es_combo=?,actualizado_en=CURRENT_TIMESTAMP WHERE id=?`)
      .run(b.codigo_interno, b.codigo_barras || null, b.nombre, b.categoria_id || null, b.marca_id || null,
        b.descripcion || null, costo, precio, Number(b.stock_minimo || 0), b.unidad || 'unidad',
        b.vencimiento || null, (b.activo === false || b.activo === '0' || b.activo === 0) ? 0 : 1,
        b.es_combo === true || b.es_combo === '1' ? 1 : 0, req.params.id);
    if (old.costo !== costo || old.precio !== precio)
      db.prepare(`INSERT INTO historial_precios(producto_id,costo_anterior,costo_nuevo,precio_anterior,precio_nuevo,usuario_id)
        VALUES(?,?,?,?,?,?)`).run(old.id, old.costo, costo, old.precio, precio, req.session.user.id);
  })();
  res.json(Catalog.product(req.params.id));
};
exports.adjust = (req, res) => {
  const quantity = Number(req.body.cantidad);
  if (!Number.isFinite(quantity) || quantity === 0) throw bad('La cantidad debe ser distinta de cero');
  const result = db.transaction(() => {
    const p = Catalog.product(req.params.id);
    if (!p) throw Object.assign(new Error('Producto no encontrado'), { status: 404 });
    if (p.es_combo) throw bad('El stock de un combo se calcula desde sus componentes');
    const next = p.stock + quantity;
    if (next < 0) throw bad('El ajuste dejaría stock negativo');
    db.prepare('UPDATE productos SET stock=?,actualizado_en=CURRENT_TIMESTAMP WHERE id=?').run(next, p.id);
    db.prepare(`INSERT INTO movimientos_inventario(producto_id,tipo,cantidad,stock_anterior,stock_nuevo,usuario_id,referencia)
      VALUES(?,'ajuste',?,?,?,?,?)`).run(p.id, quantity, p.stock, next, req.session.user.id, req.body.referencia || 'Ajuste manual');
    return { ...p, stock: next };
  })();
  res.json(result);
};
exports.meta = (req, res) => res.json({ categorias: Catalog.categories(), marcas: Catalog.brands() });
exports.addMeta = (req, res) => {
  const table = req.params.type === 'categorias' ? 'categorias' : req.params.type === 'marcas' ? 'marcas' : null;
  if (!table || !req.body.nombre?.trim()) throw bad('Dato inválido');
  const info = db.prepare(`INSERT INTO ${table}(nombre) VALUES(?)`).run(req.body.nombre.trim());
  res.status(201).json({ id: info.lastInsertRowid, nombre: req.body.nombre.trim() });
};
exports.updateMeta = (req, res) => {
  const table = req.params.type === 'categorias' ? 'categorias' : req.params.type === 'marcas' ? 'marcas' : null;
  if (!table || !req.body.nombre?.trim()) throw bad('Dato inválido');
  db.prepare(`UPDATE ${table} SET nombre=?,activo=? WHERE id=?`).run(req.body.nombre.trim(), req.body.activo === false || req.body.activo === '0' ? 0 : 1, req.params.id);
  res.json({ id:Number(req.params.id), nombre:req.body.nombre.trim() });
};
exports.deleteMeta = (req, res) => {
  const table = req.params.type === 'categorias' ? 'categorias' : req.params.type === 'marcas' ? 'marcas' : null;
  if (!table) throw bad('Dato inválido');
  db.prepare(`UPDATE ${table} SET activo=0 WHERE id=?`).run(req.params.id);
  res.json({ ok:true });
};
exports.remove = (req, res) => {
  const p=Catalog.product(req.params.id);
  if(!p) return res.status(404).json({error:'Producto no encontrado'});
  db.prepare('UPDATE productos SET activo=0,actualizado_en=CURRENT_TIMESTAMP WHERE id=?').run(p.id);
  res.json({ok:true});
};
exports.image = (req,res) => {
  if(!req.file) return res.status(400).json({error:'Seleccione una imagen válida'});
  const p=Catalog.product(req.params.id);
  if(!p) return res.status(404).json({error:'Producto no encontrado'});
  const value=`/uploads/${req.file.filename}`;
  db.prepare('UPDATE productos SET imagen=?,actualizado_en=CURRENT_TIMESTAMP WHERE id=?').run(value,p.id);
  res.json({imagen:value});
};
exports.combo = (req,res) => {
  const combo=Catalog.product(req.params.id),items=req.body.items;
  if(!combo) return res.status(404).json({error:'Producto no encontrado'});
  const uniqueItems=Array.isArray(items)?new Set(items.map(item=>Number(item.producto_id))):new Set();
  if(!combo.es_combo || !Array.isArray(items) || items.length<2 || uniqueItems.size<2)
    throw bad('Una promoción combo debe contener al menos dos productos diferentes');
  db.transaction(()=>{
    db.prepare('DELETE FROM combo_detalle WHERE combo_producto_id=?').run(combo.id);
    const insert=db.prepare('INSERT INTO combo_detalle(combo_producto_id,componente_producto_id,cantidad) VALUES(?,?,?)');
    for(const item of items){
      const product=Catalog.product(item.producto_id),quantity=Number(item.cantidad);
      if(!product||product.es_combo||product.id===combo.id||quantity<=0) throw bad('Componente de combo inválido');
      insert.run(combo.id,product.id,quantity);
    }
  })();
  res.json({combo:Catalog.product(combo.id),items:Catalog.comboItems(combo.id)});
};
exports.comboItems = (req,res) => res.json(Catalog.comboItems(req.params.id));
