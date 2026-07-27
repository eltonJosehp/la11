const db = require('../config/database');
const Catalog = require('../models/catalog');
const PDFDocument = require('pdfkit');
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
      db.prepare(`INSERT INTO detalle_venta(venta_id,producto_id,cantidad,precio,subtotal,precio_original,descuento)
        VALUES(?,?,?,?,?,?,?)`).run(v.lastInsertRowid,l.p.id,l.qty,l.p.precio,l.subtotal,l.p.precio_original,l.p.ahorro);
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
    const ahorro=Math.round(lines.reduce((sum,line)=>sum+line.p.ahorro*line.qty,0)*100)/100;
    return { id: v.lastInsertRowid, numero, total, ahorro, vuelto: Math.max(0, cash-total), comprobante: `/api/sales/${v.lastInsertRowid}/receipt` };
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

const getSale = (id,user) => {
  const sale=db.prepare(`SELECT v.*,u.nombre vendedor,p.recibido,p.vuelto
    FROM ventas v JOIN usuarios u ON u.id=v.vendedor_id LEFT JOIN pagos p ON p.venta_id=v.id
    WHERE v.id=?`).get(id);
  if(!sale || (user.rol==='vendedor' && sale.vendedor_id!==user.id)) return null;
  sale.items=db.prepare(`SELECT d.*,p.nombre,p.codigo_barras,p.codigo_interno,
    COALESCE(d.precio_original,d.precio) precio_original,
    COALESCE(d.descuento,MAX(0,COALESCE(d.precio_original,d.precio)-d.precio)) descuento
    FROM detalle_venta d JOIN productos p ON p.id=d.producto_id WHERE d.venta_id=? ORDER BY d.id`).all(id);
  return sale;
};

exports.saleDetails=(req,res)=>{
  const sale=getSale(Number(req.params.id),req.session.user);
  if(!sale)return res.status(404).json({error:'Venta no encontrada'});
  res.json(sale);
};

exports.receipt=(req,res)=>{
  const sale=getSale(Number(req.params.id),req.session.user);
  if(!sale)return res.status(404).json({error:'Venta no encontrada'});
  const config=Object.fromEntries(db.prepare('SELECT clave,valor FROM configuracion').all().map(x=>[x.clave,x.valor]));
  const width=226, height=Math.max(420,290+sale.items.length*52);
  const doc=new PDFDocument({size:[width,height],margin:18,info:{Title:`Comprobante ${sale.numero}`,Author:'Licorería La 11'}});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`${req.query.view==='1'?'inline':'attachment'}; filename="comprobante-${sale.numero}.pdf"`);
  doc.pipe(res);
  doc.font('Helvetica-Bold').fontSize(16).text(config.nombre_negocio||'LICORERÍA LA 11',{align:'center'});
  doc.font('Helvetica').fontSize(8).text(config.direccion_negocio||'Comprobante de venta',{align:'center'});
  if(config.telefono_negocio)doc.text(`Tel: ${config.telefono_negocio}`,{align:'center'});
  doc.moveDown().font('Helvetica-Bold').fontSize(9).text(`VENTA ${sale.numero}`,{align:'center'});
  doc.font('Helvetica').fontSize(8).text(new Date(`${sale.fecha}Z`).toLocaleString('es-CO'));
  doc.text(`Vendedor: ${sale.vendedor}`);
  doc.text(`Pago: ${sale.metodo_pago.toUpperCase()}`);
  doc.moveDown(.5).moveTo(18,doc.y).lineTo(width-18,doc.y).strokeColor('#999').stroke();
  doc.moveDown(.5);
  sale.items.forEach(item=>{
    doc.font('Helvetica-Bold').fontSize(8).text(item.nombre);
    if(Number(item.descuento)>0)doc.font('Helvetica').fillColor('#555').text(`Antes $${Number(item.precio_original).toLocaleString('es-CO')} · Ahorro $${Number(item.descuento*item.cantidad).toLocaleString('es-CO')}`);
    doc.fillColor('#000');
    doc.font('Helvetica').text(`${item.cantidad} × $${Number(item.precio).toLocaleString('es-CO')}   $${Number(item.subtotal).toLocaleString('es-CO')}`,{align:'right'});
  });
  doc.moveDown(.5).moveTo(18,doc.y).lineTo(width-18,doc.y).stroke();
  doc.moveDown(.5).font('Helvetica-Bold').fontSize(12).text(`TOTAL  $${Number(sale.total).toLocaleString('es-CO')}`,{align:'right'});
  const totalSaving=sale.items.reduce((sum,item)=>sum+Number(item.descuento||0)*Number(item.cantidad),0);
  if(totalSaving>0)doc.font('Helvetica-Bold').fillColor('#176642').fontSize(8).text(`AHORRO TOTAL  $${totalSaving.toLocaleString('es-CO')}`,{align:'right'}).fillColor('#000');
  if(sale.metodo_pago==='efectivo')doc.font('Helvetica').fontSize(8).text(`Recibido: $${Number(sale.recibido||0).toLocaleString('es-CO')}  ·  Vuelto: $${Number(sale.vuelto||0).toLocaleString('es-CO')}`,{align:'right'});
  doc.moveDown(1.2).font('Helvetica').fontSize(8).text(config.mensaje_comprobante||'¡Gracias por su compra!',{align:'center'});
  doc.text('Conserve este comprobante.',{align:'center'});
  doc.end();
};

exports.inventoryCounts=(req,res)=>{
  res.json(db.prepare(`SELECT c.*,u.nombre usuario,
    COUNT(d.id) productos,
    SUM(CASE WHEN d.stock_fisico IS NOT NULL THEN 1 ELSE 0 END) contados,
    COALESCE(SUM(ABS(COALESCE(d.diferencia,0))),0) diferencia_total
    FROM conteos_inventario c JOIN usuarios u ON u.id=c.usuario_id
    LEFT JOIN detalle_conteo_inventario d ON d.conteo_id=c.id
    GROUP BY c.id ORDER BY c.id DESC LIMIT 50`).all());
};

exports.createInventoryCount=(req,res)=>{
  const result=db.transaction(()=>{
    const numero=code('INV');
    const count=db.prepare('INSERT INTO conteos_inventario(numero,usuario_id,observacion) VALUES(?,?,?)')
      .run(numero,req.session.user.id,req.body.observacion||null);
    db.prepare(`INSERT INTO detalle_conteo_inventario(conteo_id,producto_id,stock_sistema)
      SELECT ?,id,stock FROM productos WHERE activo=1 AND es_combo=0`).run(count.lastInsertRowid);
    return {id:count.lastInsertRowid,numero};
  })();
  res.status(201).json(result);
};

exports.inventoryCount=(req,res)=>{
  const count=db.prepare(`SELECT c.*,u.nombre usuario FROM conteos_inventario c JOIN usuarios u ON u.id=c.usuario_id WHERE c.id=?`).get(req.params.id);
  if(!count)return res.status(404).json({error:'Conteo no encontrado'});
  count.items=db.prepare(`SELECT d.*,p.nombre,p.codigo_barras,p.codigo_interno,p.unidad
    FROM detalle_conteo_inventario d JOIN productos p ON p.id=d.producto_id
    WHERE d.conteo_id=? ORDER BY p.nombre`).all(count.id);
  res.json(count);
};

exports.updateInventoryCount=(req,res)=>{
  const count=db.prepare('SELECT * FROM conteos_inventario WHERE id=?').get(req.params.id);
  if(!count)return res.status(404).json({error:'Conteo no encontrado'});
  if(count.estado!=='borrador')throw bad('Este conteo ya fue finalizado');
  const physical=Number(req.body.stock_fisico);
  if(!Number.isFinite(physical)||physical<0)throw bad('El stock físico debe ser un número igual o mayor que cero');
  const detail=db.prepare('SELECT * FROM detalle_conteo_inventario WHERE conteo_id=? AND producto_id=?').get(count.id,req.params.productId);
  if(!detail)throw bad('Producto fuera de este conteo');
  db.prepare('UPDATE detalle_conteo_inventario SET stock_fisico=?,diferencia=? WHERE id=?')
    .run(physical,physical-detail.stock_sistema,detail.id);
  res.json({ok:true,diferencia:physical-detail.stock_sistema});
};

exports.finishInventoryCount=(req,res)=>{
  const result=db.transaction(()=>{
    const count=db.prepare('SELECT * FROM conteos_inventario WHERE id=?').get(req.params.id);
    if(!count)return null;
    if(count.estado!=='borrador')throw bad('Este conteo ya fue finalizado');
    const pending=db.prepare('SELECT COUNT(*) total FROM detalle_conteo_inventario WHERE conteo_id=? AND stock_fisico IS NULL').get(count.id).total;
    if(pending)throw bad(`Falta contar ${pending} producto(s)`);
    const differences=db.prepare(`SELECT d.*,p.stock,p.nombre FROM detalle_conteo_inventario d JOIN productos p ON p.id=d.producto_id
      WHERE d.conteo_id=? AND d.diferencia<>0`).all(count.id);
    for(const item of differences){
      const next=item.stock_fisico,delta=next-item.stock;
      db.prepare('UPDATE productos SET stock=?,actualizado_en=CURRENT_TIMESTAMP WHERE id=?').run(next,item.producto_id);
      db.prepare(`INSERT INTO movimientos_inventario(producto_id,tipo,cantidad,stock_anterior,stock_nuevo,usuario_id,referencia)
        VALUES(?,'ajuste',?,?,?,?,?)`).run(item.producto_id,delta,item.stock,next,req.session.user.id,`Conteo ${count.numero}`);
    }
    db.prepare("UPDATE conteos_inventario SET estado='finalizado',finalizado_en=CURRENT_TIMESTAMP WHERE id=?").run(count.id);
    return {numero:count.numero,ajustes:differences.length};
  })();
  if(!result)return res.status(404).json({error:'Conteo no encontrado'});
  res.json(result);
};
