const db = require('../config/database');
const Catalog = require('../models/catalog');
const bad = msg => Object.assign(new Error(msg), { status: 400 });
const code = prefix => `${prefix}-${new Date().toISOString().replace(/\D/g, '').slice(0,14)}-${Math.floor(Math.random()*900+100)}`;

exports.sale = (req, res) => {
  const { items, metodo_pago, recibido, qr_confirmado } = req.body;
  if (!Array.isArray(items) || !items.length) throw bad('La canasta está vacía');
  if (!['efectivo','qr'].includes(metodo_pago)) throw bad('Método de pago inválido');
  if (metodo_pago === 'qr' && !qr_confirmado) throw bad('Debe confirmar la recepción del pago QR');
  const result = db.transaction(() => {
    let total = 0;
    const consumption = new Map();
    const lines = items.map(i => {
      const p = Catalog.product(i.producto_id);
      const qty = Number(i.cantidad);
      if (!p || !p.activo || !Number.isFinite(qty) || qty <= 0) throw bad('Producto o cantidad inválida');
      if(p.es_combo){
        const components=Catalog.comboItems(p.id);
        if(!components.length) throw bad(`El combo ${p.nombre} no tiene componentes`);
        for(const component of components) consumption.set(component.producto_id,(consumption.get(component.producto_id)||0)+component.cantidad*qty);
      }else consumption.set(p.id,(consumption.get(p.id)||0)+qty);
      const subtotal = Math.round(p.precio * qty * 100) / 100; total += subtotal;
      return { p, qty, subtotal };
    });
    for(const [productId,qty] of consumption){
      const product=db.prepare('SELECT * FROM productos WHERE id=? AND activo=1').get(productId);
      if(!product||product.stock<qty) throw bad(`Stock insuficiente para ${product?.nombre||'un componente'} (disponible: ${product?.stock||0})`);
    }
    total = Math.round(total * 100) / 100;
    if (metodo_pago === 'efectivo' && Number(recibido) < total) throw bad('El monto recibido es insuficiente');
    const numero = code('V');
    const v = db.prepare(`INSERT INTO ventas(numero,fecha,vendedor_id,total,metodo_pago) VALUES(?,CURRENT_TIMESTAMP,?,?,?)`)
      .run(numero, req.session.user.id, total, metodo_pago);
    for (const l of lines) {
      db.prepare('INSERT INTO detalle_venta(venta_id,producto_id,cantidad,precio,subtotal) VALUES(?,?,?,?,?)')
        .run(v.lastInsertRowid, l.p.id, l.qty, l.p.precio, l.subtotal);
    }
    for(const [productId,qty] of consumption){
      const product=db.prepare('SELECT * FROM productos WHERE id=?').get(productId),next=product.stock-qty;
      db.prepare('UPDATE productos SET stock=?,actualizado_en=CURRENT_TIMESTAMP WHERE id=?').run(next,product.id);
      db.prepare(`INSERT INTO movimientos_inventario(producto_id,tipo,cantidad,stock_anterior,stock_nuevo,usuario_id,referencia)
        VALUES(?,'venta',?,?,?,?,?)`).run(product.id,-qty,product.stock,next,req.session.user.id,numero);
    }
    const cash = metodo_pago === 'efectivo' ? Number(recibido) : total;
    db.prepare('INSERT INTO pagos(venta_id,metodo,importe,recibido,vuelto,confirmado) VALUES(?,?,?,?,?,1)')
      .run(v.lastInsertRowid, metodo_pago, total, cash, Math.max(0, cash-total));
    return { id: v.lastInsertRowid, numero, total, vuelto: Math.max(0, cash-total) };
  })();
  res.status(201).json(result);
};

exports.purchase = (req, res) => {
  const { proveedor_id, documento, fecha, items } = req.body;
  if (!proveedor_id || !Array.isArray(items) || !items.length) throw bad('Proveedor y productos son obligatorios');
  const result = db.transaction(() => {
    let total = 0;
    const lines = items.map(i => {
      const p = db.prepare('SELECT * FROM productos WHERE id=? AND activo=1').get(i.producto_id);
      const qty = Number(i.cantidad), cost = Number(i.costo);
      if (!p || p.es_combo || qty <= 0 || cost < 0) throw bad('Producto, cantidad o costo inválido');
      const subtotal = Math.round(qty*cost*100)/100; total += subtotal;
      return { p, qty, cost, subtotal };
    });
    total = Math.round(total*100)/100; const numero = code('C');
    const c = db.prepare(`INSERT INTO compras(numero,proveedor_id,documento,fecha,total,usuario_id) VALUES(?,?,?,?,?,?)`)
      .run(numero, proveedor_id, documento || null, fecha || new Date().toISOString().slice(0,10), total, req.session.user.id);
    for (const l of lines) {
      const next = l.p.stock + l.qty;
      db.prepare('INSERT INTO detalle_compra(compra_id,producto_id,cantidad,costo,subtotal) VALUES(?,?,?,?,?)')
        .run(c.lastInsertRowid, l.p.id, l.qty, l.cost, l.subtotal);
      db.prepare('UPDATE productos SET stock=?,costo=?,actualizado_en=CURRENT_TIMESTAMP WHERE id=?').run(next,l.cost,l.p.id);
      db.prepare(`INSERT INTO movimientos_inventario(producto_id,tipo,cantidad,stock_anterior,stock_nuevo,usuario_id,referencia)
        VALUES(?,'compra',?,?,?,?,?)`).run(l.p.id,l.qty,l.p.stock,next,req.session.user.id,numero);
      if (l.p.costo !== l.cost) db.prepare(`INSERT INTO historial_precios(producto_id,costo_anterior,costo_nuevo,precio_anterior,precio_nuevo,usuario_id)
        VALUES(?,?,?,?,?,?)`).run(l.p.id,l.p.costo,l.cost,l.p.precio,l.p.precio,req.session.user.id);
      db.prepare('INSERT OR IGNORE INTO producto_proveedor(producto_id,proveedor_id) VALUES(?,?)').run(l.p.id,proveedor_id);
    }
    return { id:c.lastInsertRowid,numero,total };
  })();
  res.status(201).json(result);
};

exports.movements = (req,res) => res.json(db.prepare(`SELECT mi.*,p.nombre producto,u.nombre usuario
  FROM movimientos_inventario mi JOIN productos p ON p.id=mi.producto_id JOIN usuarios u ON u.id=mi.usuario_id
  WHERE (? IS NULL OR mi.producto_id=?) ORDER BY mi.id DESC LIMIT 300`).all(req.query.producto_id||null,req.query.producto_id||null));
exports.sales = (req,res) => {
  const own = req.session.user.rol === 'vendedor';
  res.json(db.prepare(`SELECT v.*,u.nombre vendedor FROM ventas v JOIN usuarios u ON u.id=v.vendedor_id
    ${own?'WHERE v.vendedor_id=?':''} ORDER BY v.id DESC LIMIT 100`).all(...(own?[req.session.user.id]:[])));
};
