/**
 * E2E de UI en Chrome real:
 *  1. Validación de fechas inline (inicio pasado, fin anterior, más de 90 días) y botón deshabilitado.
 *  2. Admin crea el cliente "Pedro Pruebas / pedro@test.com / password123" desde /admin/usuarios,
 *     ve las credenciales y las copia; el panel muestra ingresos reales.
 *  3. Cierra sesión, entra como Pedro (rol cliente), hace una reserva corta con el simulador de pago
 *     y la ve en "Mis reservas". Al final cancela la reserva para no dejar el vehículo bloqueado.
 *
 * Uso:  node frontend/scripts/e2e-usuarios.mjs [URL]   (por defecto producción en Vercel)
 */
import { chromium } from 'playwright-core';

const WEB = process.argv[2] || 'https://booking-rentafacil-reto1.vercel.app';
const PEDRO = { nombre: 'Pedro', apellido: 'Pruebas', email: 'pedro@test.com', password: 'password123' };
let ok = 0, fail = 0;
const check = (n, c, x = '') => { c ? (ok++, console.log(`  ✔ ${n}`)) : (fail++, console.log(`  ✘ ${n} ${x}`)); };

const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
page.setDefaultTimeout(90_000); // Render Free puede tardar en despertar
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
let apiBase = '';
page.on('request', (r) => { const m = /^(.*\/api\/v1)\//.exec(r.url()); if (m && !apiBase) apiBase = m[1]; });

const fecha = (dias) => { const d = new Date(Date.now() + dias * 864e5); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
async function login(email, password) {
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}
async function logout() {
  await page.locator('.nav-desktop').getByRole('button', { name: 'Salir' }).click();
  await page.waitForURL((u) => u.pathname === '/');
}

try {
  console.log(`\n# ${WEB}`);
  console.log('\n# Validación de fechas (inicio)');
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  const ini = page.locator('#home-ini'), fin = page.locator('#home-fin'), buscar = page.getByRole('button', { name: 'Buscar vehículos' });
  check('el input de inicio tiene min = hoy', (await ini.getAttribute('min')) === fecha(0), await ini.getAttribute('min'));
  await ini.fill(fecha(-2));
  check('inicio en el pasado: mensaje inline', await page.getByText('La fecha de inicio no puede ser en el pasado').isVisible());
  check('botón Buscar deshabilitado', await buscar.isDisabled());
  await ini.fill(fecha(3)); await fin.fill(fecha(2));
  check('fin anterior al inicio: mensaje inline', await page.getByText('La fecha de fin debe ser posterior a la de inicio').isVisible());
  await fin.fill(fecha(100));
  check('más de 90 días: mensaje inline', await page.getByText('El alquiler no puede superar los 90 días').isVisible());
  await fin.fill(fecha(5));
  check('fechas válidas: sin errores y botón habilitado', (await page.locator('[role="alert"]').count()) === 0 && await buscar.isEnabled());

  console.log('\n# Admin crea a Pedro');
  await login('admin@rentafacil.ec', 'Admin12345');
  await page.goto(`${WEB}/admin`, { waitUntil: 'domcontentloaded' });
  const ingresos = page.locator('.card', { hasText: 'Ingresos totales' });
  await page.waitForFunction(() => document.querySelector('[aria-busy="false"]'), null, { timeout: 60_000 });
  const ingresosTxt = (await ingresos.textContent())?.replace('Ingresos totales', '').trim();
  check('el panel muestra ingresos reales', /^\$[\d,]+\.\d{2}$/.test(ingresosTxt || '') && ingresosTxt !== '$0.00', ingresosTxt);
  console.log(`    ingresos totales: ${ingresosTxt}`);

  // Si Pedro ya existe de una corrida anterior, se elimina antes para poder recrearlo
  const tok = await page.evaluate(() => localStorage.getItem('rf_token'));
  const existentes = await (await page.request.get(`${apiBase}/admin/users`, { headers: { Authorization: `Bearer ${tok}` } })).json();
  for (const u of existentes.filter((x) => x.email === PEDRO.email)) {
    await page.request.delete(`${apiBase}/admin/users/${u.user_id}`, { headers: { Authorization: `Bearer ${tok}` } });
  }

  await page.getByRole('link', { name: '+ Nuevo cliente' }).click();
  await page.waitForURL(/\/admin\/usuarios/);
  const modal = page.getByRole('dialog');
  await modal.waitFor();
  check('"+ Nuevo cliente" del panel abre el modal en /admin/usuarios', true);
  await modal.getByRole('button', { name: 'Crear cliente' }).click();
  check('valida campos obligatorios', (await modal.locator('[role="alert"]').count()) >= 4);
  await modal.getByLabel('Nombre *').fill(PEDRO.nombre);
  await modal.getByLabel('Apellido *').fill(PEDRO.apellido);
  await modal.getByLabel('Correo electrónico *').fill(PEDRO.email);
  await modal.getByRole('button', { name: 'Generar contraseña aleatoria' }).click();
  const generada = await modal.getByLabel('Contraseña *').inputValue();
  check('genera contraseña fuerte (14 chars, mayús/minús/dígito/símbolo)', generada.length === 14 && /[A-Z]/.test(generada) && /[a-z]/.test(generada) && /\d/.test(generada) && /[^A-Za-z0-9]/.test(generada), generada);
  await modal.getByLabel('Contraseña *').fill(PEDRO.password);
  check('rol por defecto: Cliente', (await modal.getByLabel('Rol').inputValue()) === 'client');
  await modal.getByRole('button', { name: 'Crear cliente' }).click();
  await modal.getByText('El usuario se creó correctamente').waitFor();
  check('muestra las credenciales creadas', (await modal.textContent()).includes(PEDRO.email) && (await modal.textContent()).includes(PEDRO.password));
  await modal.getByRole('button', { name: 'Copiar credenciales' }).click();
  // Windows convierte \n en \r\n al leer el portapapeles del sistema: se normaliza
  const portapapeles = (await page.evaluate(() => navigator.clipboard.readText()).catch(() => '')).replace(/\r\n/g, '\n');
  check('copia "Email: X\\nContraseña: Y" al portapapeles', portapapeles === `Email: ${PEDRO.email}\nContraseña: ${PEDRO.password}`, JSON.stringify(portapapeles));
  await modal.getByRole('button', { name: 'Cerrar' }).click();
  const fila = page.locator('tr', { hasText: PEDRO.email });
  check('Pedro aparece en la tabla como Cliente', (await fila.textContent()).includes('Cliente'));

  // Editar: teléfono
  await fila.getByRole('button', { name: 'Editar' }).click();
  await modal.getByLabel('Teléfono').fill('+593 99 765 4321');
  await modal.getByRole('button', { name: 'Guardar cambios' }).click();
  await modal.waitFor({ state: 'detached' });
  check('editar usuario (teléfono)', (await page.locator('tr', { hasText: PEDRO.email }).textContent()).includes('+593 99 765 4321'));
  await logout();

  console.log('\n# Pedro inicia sesión y reserva');
  await login(PEDRO.email, PEDRO.password);
  check('Pedro entra como cliente (sin enlace Admin)', (await page.locator('.nav-desktop').getByRole('link', { name: 'Admin' }).count()) === 0);
  await page.goto(`${WEB}/catalogo?ini=${fecha(10)}&fin=${fecha(12)}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.veh-card-link').first().click();
  await page.waitForURL(/\/vehiculos\//);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('heading', { name: 'Confirmar reserva' }).waitFor();
  await page.locator('aside input').first().fill(PEDRO.nombre);
  await page.locator('aside input').nth(1).fill(PEDRO.apellido);
  await page.getByRole('button', { name: 'Confirmar reserva' }).click();
  const pago = page.getByRole('dialog');
  await pago.getByRole('button', { name: 'Usar tarjeta de prueba' }).click();
  await pago.getByRole('button', { name: 'Pagar ahora' }).click();
  await page.waitForURL(/\/reserva\//);
  const locator = (await page.locator('code', { hasText: 'RENTAFACIL-' }).textContent())?.trim();
  check('reserva confirmada', /^RENTAFACIL-/.test(locator || ''), locator);
  const orderId = page.url().split('/reserva/')[1];

  await page.evaluate(() => localStorage.removeItem('rf_myorders')); // demuestra que no depende del navegador
  await page.goto(`${WEB}/mis-reservas`, { waitUntil: 'domcontentloaded' });
  const tarjeta = page.locator('.card', { hasText: locator });
  await tarjeta.waitFor();
  check('la reserva aparece en "Mis reservas" (desde el servidor)', (await tarjeta.textContent()).includes('Confirmada'));

  // Limpieza: cancelar para liberar el vehículo (la reserva sigue visible como Cancelada)
  page.once('dialog', (d) => d.accept());
  await tarjeta.getByRole('button', { name: 'Cancelar' }).click();
  await page.locator('.card', { hasText: locator }).getByText('Cancelada').waitFor();
  check('limpieza: reserva de prueba cancelada', true);
  void orderId;
} catch (e) {
  fail++; console.error('ERROR', e.message);
  await page.screenshot({ path: 'e2e-usuarios-error.png', fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  console.log(`\nResultado: ${ok} OK, ${fail} fallos`);
  process.exit(fail ? 1 : 0);
}
