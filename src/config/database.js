const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbPath = path.resolve(process.env.DB_PATH || './data/bodega.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE CHECK(nombre IN ('administrador','vendedor'))
);
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT, usuario TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL, password_hash TEXT NOT NULL, rol_id INTEGER NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0,1)),
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(rol_id) REFERENCES roles(id)
);
CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL COLLATE NOCASE UNIQUE,
  activo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS marcas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL COLLATE NOCASE UNIQUE,
  activo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, codigo_interno TEXT NOT NULL UNIQUE,
  codigo_barras TEXT UNIQUE, nombre TEXT NOT NULL, categoria_id INTEGER, marca_id INTEGER,
  descripcion TEXT, costo REAL NOT NULL DEFAULT 0 CHECK(costo >= 0),
  precio REAL NOT NULL CHECK(precio >= 0), stock REAL NOT NULL DEFAULT 0 CHECK(stock >= 0),
  stock_minimo REAL NOT NULL DEFAULT 0 CHECK(stock_minimo >= 0),
  unidad TEXT NOT NULL DEFAULT 'unidad', vencimiento TEXT, activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(categoria_id) REFERENCES categorias(id), FOREIGN KEY(marca_id) REFERENCES marcas(id)
);
CREATE INDEX IF NOT EXISTS idx_productos_nombre ON productos(nombre);
CREATE INDEX IF NOT EXISTS idx_productos_barra ON productos(codigo_barras);
CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ruc TEXT UNIQUE, razon_social TEXT NOT NULL,
  nombre_comercial TEXT, telefono TEXT, correo TEXT, direccion TEXT, contacto TEXT,
  activo INTEGER NOT NULL DEFAULT 1, creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS producto_proveedor (
  producto_id INTEGER NOT NULL, proveedor_id INTEGER NOT NULL, codigo_proveedor TEXT,
  PRIMARY KEY(producto_id, proveedor_id),
  FOREIGN KEY(producto_id) REFERENCES productos(id), FOREIGN KEY(proveedor_id) REFERENCES proveedores(id)
);
CREATE TABLE IF NOT EXISTS compras (
  id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT NOT NULL UNIQUE, proveedor_id INTEGER NOT NULL,
  documento TEXT, fecha TEXT NOT NULL, total REAL NOT NULL CHECK(total >= 0), usuario_id INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'confirmada', creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(proveedor_id) REFERENCES proveedores(id), FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
);
CREATE TABLE IF NOT EXISTS detalle_compra (
  id INTEGER PRIMARY KEY AUTOINCREMENT, compra_id INTEGER NOT NULL, producto_id INTEGER NOT NULL,
  cantidad REAL NOT NULL CHECK(cantidad > 0), costo REAL NOT NULL CHECK(costo >= 0),
  subtotal REAL NOT NULL CHECK(subtotal >= 0),
  FOREIGN KEY(compra_id) REFERENCES compras(id), FOREIGN KEY(producto_id) REFERENCES productos(id)
);
CREATE TABLE IF NOT EXISTS ventas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT NOT NULL UNIQUE, fecha TEXT NOT NULL,
  vendedor_id INTEGER NOT NULL, total REAL NOT NULL CHECK(total >= 0),
  metodo_pago TEXT NOT NULL CHECK(metodo_pago IN ('efectivo','qr')),
  estado TEXT NOT NULL DEFAULT 'confirmada', creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(vendedor_id) REFERENCES usuarios(id)
);
CREATE TABLE IF NOT EXISTS detalle_venta (
  id INTEGER PRIMARY KEY AUTOINCREMENT, venta_id INTEGER NOT NULL, producto_id INTEGER NOT NULL,
  cantidad REAL NOT NULL CHECK(cantidad > 0), precio REAL NOT NULL CHECK(precio >= 0),
  subtotal REAL NOT NULL CHECK(subtotal >= 0),
  FOREIGN KEY(venta_id) REFERENCES ventas(id), FOREIGN KEY(producto_id) REFERENCES productos(id)
);
CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, venta_id INTEGER NOT NULL, metodo TEXT NOT NULL,
  importe REAL NOT NULL, recibido REAL, vuelto REAL, confirmado INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(venta_id) REFERENCES ventas(id)
);
CREATE TABLE IF NOT EXISTS movimientos_inventario (
  id INTEGER PRIMARY KEY AUTOINCREMENT, producto_id INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('compra','venta','ajuste','devolucion')),
  cantidad REAL NOT NULL, stock_anterior REAL NOT NULL, stock_nuevo REAL NOT NULL CHECK(stock_nuevo >= 0),
  usuario_id INTEGER NOT NULL, referencia TEXT, fecha TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(producto_id) REFERENCES productos(id), FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS idx_mov_producto_fecha ON movimientos_inventario(producto_id, fecha);
CREATE TABLE IF NOT EXISTS historial_precios (
  id INTEGER PRIMARY KEY AUTOINCREMENT, producto_id INTEGER NOT NULL, costo_anterior REAL,
  costo_nuevo REAL, precio_anterior REAL, precio_nuevo REAL, usuario_id INTEGER NOT NULL,
  fecha TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(producto_id) REFERENCES productos(id), FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
);
CREATE TABLE IF NOT EXISTS configuracion (
  clave TEXT PRIMARY KEY, valor TEXT, actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

db.prepare("INSERT OR IGNORE INTO roles(id,nombre) VALUES(1,'administrador'),(2,'vendedor')").run();
const adminUser = process.env.ADMIN_USER || 'admin';
if (!db.prepare('SELECT 1 FROM usuarios WHERE usuario=?').get(adminUser)) {
  db.prepare('INSERT INTO usuarios(usuario,nombre,password_hash,rol_id) VALUES(?,?,?,1)')
    .run(adminUser, 'Administrador', bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Admin123!', 12));
}

module.exports = db;
