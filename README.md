# Licorería La 11 — Gestión de bodega

Aplicación web responsive con arquitectura MVC, Node.js, Express y SQLite. Incluye POS, compras, productos, proveedores, inventario trazable, usuarios por rol, pagos en efectivo/QR, comprobantes PDF y dashboard administrativo con gráficos.

## Puesta en marcha

Requisitos: Node.js 20 o superior.

```bash
npm install
copy .env.example .env
npm start
```

Abra `http://localhost:3000`. En la primera ejecución se crea automáticamente la base `data/bodega.db`.

Credenciales iniciales:

- Usuario: `admin`
- Contraseña: `Admin123!`

Antes de usar el sistema en producción, cambie `ADMIN_PASSWORD` y `SESSION_SECRET` en `.env`. Las variables del administrador solo se usan al crear la cuenta por primera vez.

## Operación inicial recomendada

1. Ingrese como administrador.
2. Cree categorías y marcas según sea necesario al registrar productos.
3. Registre proveedores.
4. Registre productos (el stock inicial se mantiene en cero).
5. Use **Compras** para ingresar existencias, o **Inventario** para un ajuste inicial documentado.
6. Configure la imagen del QR en **Configuración**.
7. Cree cuentas con rol `vendedor`.

## Reglas implementadas

- Código interno y código de barras únicos.
- Sesiones persistentes en SQLite, cookies `httpOnly` y control de roles en backend.
- Contraseñas con hash bcrypt.
- Compras, ventas y ajustes generan movimientos de inventario.
- Las compras y ventas se confirman dentro de transacciones SQLite.
- El servidor rechaza ventas sin stock, aunque el frontend sea manipulado.
- El detalle de venta conserva el precio histórico aplicado.
- Cada venta genera un comprobante PDF descargable inmediatamente o desde el historial.
- Los conteos físicos comparan stock esperado y real; al finalizar, las diferencias generan ajustes trazables.
- Los combos exigen al menos dos productos y descuentan automáticamente las existencias de sus componentes.
- El precio original del combo se calcula sumando los precios base de sus componentes; su precio especial debe producir un ahorro real.
- Los productos admiten descuentos porcentuales o fijos, con nombre y vigencia opcional, sin modificar su precio original.
- La venta y el comprobante conservan el precio original, el precio aplicado y el ahorro histórico.
- Los cambios de costo/precio generan historial.
- El vendedor no puede acceder a costos, proveedores, usuarios, inventario administrativo ni configuración.
- SQLite usa claves foráneas, restricciones, índices y modo WAL.

## Cámara y códigos de barras

El botón **Escanear** usa `BarcodeDetector` cuando está disponible. El acceso a cámara requiere `localhost` o HTTPS y permiso del usuario. En navegadores sin esa API, la búsqueda por nombre, código interno o código de barras permanece disponible.

## Estructura

```text
src/
  config/       conexión, esquema y migración inicial
  controllers/  autenticación, catálogo, operaciones y administración
  middleware/   sesiones, roles y errores
  models/       consultas del dominio
  routes/       endpoints HTTP
  views/        vista principal
public/
  css/          sistema visual responsive
  js/           cliente web y escáner
  uploads/      QR de pago
```

## Seguridad de despliegue

Use HTTPS, una clave de sesión aleatoria, un proceso Node administrado (por ejemplo, systemd o PM2), respaldos periódicos de `data/bodega.db` y permisos de escritura limitados a `data/` y `public/uploads/`.

## Despliegue gratuito en Render

El repositorio incluye `render.yaml`. Desde el panel de Render, cree un **Blueprint**, seleccione este repositorio e introduzca una contraseña segura en `ADMIN_PASSWORD`.

> El sistema funciona en el plan gratuito, pero Render elimina la base SQLite y las imágenes cargadas cuando el servicio reinicia, se suspende o vuelve a desplegarse. Esta modalidad es únicamente para demostración.
