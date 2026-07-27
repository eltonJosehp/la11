const bcrypt = require('bcryptjs');
const db = require('../config/database');
exports.dashboard = (req,res) => {
  const one = sql => db.prepare(sql).get();
  res.json({
    ventas_hoy: one("SELECT COALESCE(SUM(total),0) valor FROM ventas WHERE estado='confirmada' AND date(fecha)=date('now','localtime')").valor,
    ventas_mes: one("SELECT COALESCE(SUM(total),0) valor FROM ventas WHERE estado='confirmada' AND strftime('%Y-%m',fecha)=strftime('%Y-%m','now','localtime')").valor,
    productos: one('SELECT COUNT(*) valor FROM productos WHERE activo=1').valor,
    stock_bajo: one('SELECT COUNT(*) valor FROM productos WHERE activo=1 AND stock>0 AND stock<=stock_minimo').valor,
    agotados: one('SELECT COUNT(*) valor FROM productos WHERE activo=1 AND stock=0').valor,
    valor_inventario: one('SELECT COALESCE(SUM(costo*stock),0) valor FROM productos WHERE activo=1 AND es_combo=0').valor,
    margen_mes: one(`SELECT COALESCE(SUM((d.precio-(CASE WHEN p.es_combo=1 THEN COALESCE((
      SELECT SUM(cp.costo*cd.cantidad) FROM combo_detalle cd JOIN productos cp ON cp.id=cd.componente_producto_id
      WHERE cd.combo_producto_id=p.id),0) ELSE p.costo END))*d.cantidad),0) valor FROM detalle_venta d
      JOIN ventas v ON v.id=d.venta_id JOIN productos p ON p.id=d.producto_id
      WHERE v.estado='confirmada' AND strftime('%Y-%m',v.fecha)=strftime('%Y-%m','now','localtime')`).valor,
    ahorro_clientes_mes: one(`SELECT COALESCE(SUM(COALESCE(d.descuento,0)*d.cantidad),0) valor
      FROM detalle_venta d JOIN ventas v ON v.id=d.venta_id WHERE v.estado='confirmada'
      AND strftime('%Y-%m',v.fecha)=strftime('%Y-%m','now','localtime')`).valor,
    promociones_activas: one(`SELECT COUNT(*) valor FROM productos p WHERE p.activo=1 AND (
      (p.es_combo=1 AND p.precio<(SELECT COALESCE(SUM(cp.precio*cd.cantidad),0) FROM combo_detalle cd JOIN productos cp ON cp.id=cd.componente_producto_id WHERE cd.combo_producto_id=p.id))
      OR (p.es_combo=0 AND p.descuento_tipo<>'ninguno' AND p.descuento_valor>0
        AND (p.descuento_inicio IS NULL OR date(p.descuento_inicio)<=date('now','localtime'))
        AND (p.descuento_fin IS NULL OR date(p.descuento_fin)>=date('now','localtime'))))`).valor,
    ventas_7_dias: db.prepare(`WITH RECURSIVE dias(fecha) AS (
      SELECT date('now','localtime','-6 days') UNION ALL SELECT date(fecha,'+1 day') FROM dias WHERE fecha<date('now','localtime')
    ) SELECT dias.fecha,COALESCE(SUM(v.total),0) total FROM dias LEFT JOIN ventas v ON date(v.fecha)=dias.fecha AND v.estado='confirmada'
      GROUP BY dias.fecha ORDER BY dias.fecha`).all(),
    ventas_categoria: db.prepare(`SELECT COALESCE(c.nombre,'Sin categoría') categoria,SUM(d.subtotal) total
      FROM detalle_venta d JOIN ventas v ON v.id=d.venta_id JOIN productos p ON p.id=d.producto_id
      LEFT JOIN categorias c ON c.id=p.categoria_id WHERE v.estado='confirmada'
      GROUP BY c.id ORDER BY total DESC LIMIT 6`).all(),
    mas_vendidos: db.prepare(`SELECT p.nombre,SUM(d.cantidad) cantidad FROM detalle_venta d JOIN productos p ON p.id=d.producto_id
      JOIN ventas v ON v.id=d.venta_id WHERE v.estado='confirmada' GROUP BY p.id ORDER BY cantidad DESC LIMIT 5`).all(),
    ultimas_ventas: db.prepare('SELECT numero,total,fecha FROM ventas ORDER BY id DESC LIMIT 5').all()
  });
};
exports.suppliers = (req,res) => res.json(db.prepare('SELECT * FROM proveedores ORDER BY razon_social').all());
exports.saveSupplier = (req,res) => {
  const b=req.body;
  if(!b.razon_social?.trim()) return res.status(400).json({error:'La razón social es obligatoria'});
  const i=db.prepare(`INSERT INTO proveedores(ruc,razon_social,nombre_comercial,telefono,correo,direccion,contacto)
    VALUES(?,?,?,?,?,?,?)`).run(b.ruc||null,b.razon_social.trim(),b.nombre_comercial||null,b.telefono||null,b.correo||null,b.direccion||null,b.contacto||null);
  res.status(201).json({id:i.lastInsertRowid});
};
exports.updateSupplier=(req,res)=>{
  const b=req.body;
  if(!b.razon_social?.trim()) return res.status(400).json({error:'La razón social es obligatoria'});
  db.prepare(`UPDATE proveedores SET ruc=?,razon_social=?,nombre_comercial=?,telefono=?,correo=?,direccion=?,contacto=?,activo=? WHERE id=?`)
    .run(b.ruc||null,b.razon_social.trim(),b.nombre_comercial||null,b.telefono||null,b.correo||null,b.direccion||null,b.contacto||null,
      b.activo===false||b.activo==='0'?0:1,req.params.id);
  res.json({id:Number(req.params.id)});
};
exports.deleteSupplier=(req,res)=>{db.prepare('UPDATE proveedores SET activo=0 WHERE id=?').run(req.params.id);res.json({ok:true})};
exports.users=(req,res)=>res.json(db.prepare(`SELECT u.id,u.usuario,u.nombre,u.activo,r.nombre rol FROM usuarios u JOIN roles r ON r.id=u.rol_id ORDER BY u.nombre`).all());
exports.saveUser=(req,res)=>{
  const b=req.body;if(!b.usuario||!b.nombre||!b.password||!['administrador','vendedor'].includes(b.rol)) return res.status(400).json({error:'Datos de usuario inválidos'});
  const role=db.prepare('SELECT id FROM roles WHERE nombre=?').get(b.rol);
  const i=db.prepare('INSERT INTO usuarios(usuario,nombre,password_hash,rol_id) VALUES(?,?,?,?)').run(b.usuario.trim(),b.nombre.trim(),bcrypt.hashSync(b.password,12),role.id);
  res.status(201).json({id:i.lastInsertRowid});
};
exports.updateUser=(req,res)=>{
  const b=req.body,user=db.prepare('SELECT * FROM usuarios WHERE id=?').get(req.params.id);
  if(!user||!b.usuario?.trim()||!b.nombre?.trim()||!['administrador','vendedor'].includes(b.rol)) return res.status(400).json({error:'Datos de usuario inválidos'});
  const role=db.prepare('SELECT id FROM roles WHERE nombre=?').get(b.rol);
  if(b.password) db.prepare('UPDATE usuarios SET usuario=?,nombre=?,password_hash=?,rol_id=?,activo=? WHERE id=?')
    .run(b.usuario.trim(),b.nombre.trim(),bcrypt.hashSync(b.password,12),role.id,b.activo===false||b.activo==='0'?0:1,user.id);
  else db.prepare('UPDATE usuarios SET usuario=?,nombre=?,rol_id=?,activo=? WHERE id=?')
    .run(b.usuario.trim(),b.nombre.trim(),role.id,b.activo===false||b.activo==='0'?0:1,user.id);
  res.json({id:user.id});
};
exports.deleteUser=(req,res)=>{
  if(Number(req.params.id)===req.session.user.id) return res.status(400).json({error:'No puede desactivar su propia cuenta'});
  db.prepare('UPDATE usuarios SET activo=0 WHERE id=?').run(req.params.id);res.json({ok:true});
};
exports.config=(req,res)=>res.json(Object.fromEntries(db.prepare('SELECT clave,valor FROM configuracion').all().map(x=>[x.clave,x.valor])));
exports.qr=(req,res)=>{
  if(!req.file) return res.status(400).json({error:'Seleccione una imagen'});
  const value=`/uploads/${req.file.filename}`;
  db.prepare(`INSERT INTO configuracion(clave,valor) VALUES('qr_pago',?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor,actualizado_en=CURRENT_TIMESTAMP`).run(value);
  res.json({qr_pago:value});
};
exports.saveConfig=(req,res)=>{
  const allowed=['nombre_negocio','direccion_negocio','telefono_negocio','mensaje_comprobante'];
  const save=db.prepare(`INSERT INTO configuracion(clave,valor) VALUES(?,?)
    ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor,actualizado_en=CURRENT_TIMESTAMP`);
  db.transaction(()=>allowed.forEach(key=>save.run(key,String(req.body[key]||'').trim())))();
  res.json({ok:true});
};
