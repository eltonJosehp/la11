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
exports.users=(req,res)=>res.json(db.prepare(`SELECT u.id,u.usuario,u.nombre,u.activo,r.nombre rol FROM usuarios u JOIN roles r ON r.id=u.rol_id ORDER BY u.nombre`).all());
exports.saveUser=(req,res)=>{
  const b=req.body;if(!b.usuario||!b.nombre||!b.password||!['administrador','vendedor'].includes(b.rol)) return res.status(400).json({error:'Datos de usuario inválidos'});
  const role=db.prepare('SELECT id FROM roles WHERE nombre=?').get(b.rol);
  const i=db.prepare('INSERT INTO usuarios(usuario,nombre,password_hash,rol_id) VALUES(?,?,?,?)').run(b.usuario.trim(),b.nombre.trim(),bcrypt.hashSync(b.password,12),role.id);
  res.status(201).json({id:i.lastInsertRowid});
};
exports.config=(req,res)=>res.json(Object.fromEntries(db.prepare('SELECT clave,valor FROM configuracion').all().map(x=>[x.clave,x.valor])));
exports.qr=(req,res)=>{
  if(!req.file) return res.status(400).json({error:'Seleccione una imagen'});
  const value=`/uploads/${req.file.filename}`;
  db.prepare(`INSERT INTO configuracion(clave,valor) VALUES('qr_pago',?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor,actualizado_en=CURRENT_TIMESTAMP`).run(value);
  res.json({qr_pago:value});
};
