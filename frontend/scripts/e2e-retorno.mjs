/**
 * E2E de UI en Chrome real: devolucion de un vehiculo desde el panel admin.
 *   API: crea una reserva (search -> hold -> preview -> create)
 *   UI:  /admin/orders -> "Registrar retorno" -> modal -> badge "DEVUELTO el ..."
 *        /admin/vehiculos -> badge "En lavado" con la fecha "hasta ..."
 *
 * Uso:  node frontend/scripts/e2e-retorno.mjs [URL_WEB] [URL_API]
 *       (por defecto produccion: Vercel + Render)
 * Requiere playwright-core (npm i -D playwright-core) y Google Chrome instalado.
 * Nota: deja el vehiculo usado en lavado 24 h (vuelve solo a disponible).
 */
import { chromium } from 'playwright-core';
import { randomUUID } from 'node:crypto';

const WEB = process.argv[2] || 'https://booking-rentafacil-reto1.vercel.app';
const API = (process.argv[3] || 'https://rentafacil-api.onrender.com') + '/api/v1';
const SHOT = process.env.SCREENSHOT;
let ok = 0, fail = 0;
const check = (n, c, x = '') => { c ? (ok++, console.log(`  ✔ ${n}`)) : (fail++, console.log(`  ✘ ${n} ${x}`)); };

async function api(method, path, { body, token, headers = {} } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90_000),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

// 1. Reserva por API (fecha lejana y aleatoria para no chocar con otras pruebas)
console.log(`\n# ${WEB}  (API ${API})`);
const admin = (await api('POST', '/auth/token', { body: { email: 'admin@rentafacil.ec', password: 'Admin12345' } })).json;
const pick = new Date(Date.now() + (120 + Math.floor(Math.random() * 200)) * 864e5); pick.setUTCHours(10, 0, 0, 0);
const drop = new Date(pick.getTime() + 2 * 864e5);
const s = (await api('POST', '/search', {
  headers: { 'X-Affiliate-Id': '1' },
  body: { booker: { country: 'ec' }, currency: 'USD', driver: { age: 30 },
    route: { pickup: { datetime: pick.toISOString(), location: {} }, dropoff: { datetime: drop.toISOString(), location: {} } } },
})).json;
const vehicleId = s.data[s.data.length - 1].vehicle_id;
const hold = (await api('POST', '/orders/hold', { token: admin.access_token, body: { vehicle_id: vehicleId, search_token: s.search_token, driver: { age: 30 } } })).json;
const prev = (await api('POST', '/orders/preview', { token: admin.access_token, body: { vehicle_id: vehicleId, search_token: s.search_token, hold_id: hold.hold_id } })).json;
const order = (await api('POST', '/orders/create', {
  token: admin.access_token, headers: { 'Idempotency-Key': randomUUID() },
  body: { order_preview_id: prev.data.order_preview_id, payment_reference: `PAY-E2E-RET-${Date.now()}`,
    driver_details: { first_name: 'Prueba', last_name: 'Retorno', email: 'e2e@rentafacil.ec', phone_number: '+593 99 000 0000' } },
})).json;
check(`reserva creada por API (${order.locator}, ${vehicleId})`, !!order.order_id);

// 2. UI del admin
const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
page.setDefaultTimeout(90_000);
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
await page.getByLabel('Correo electrónico').fill('admin@rentafacil.ec');
await page.getByLabel('Contraseña').fill('Admin12345');
await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'));

await page.goto(`${WEB}/admin/orders`, { waitUntil: 'domcontentloaded' });
const fila = page.locator('tr', { hasText: order.locator });
await fila.waitFor();
const boton = fila.getByRole('button', { name: 'Registrar retorno' });
check('botón "Registrar retorno" visible en la orden confirmada', await boton.isVisible());

await boton.click();
const modal = page.getByRole('dialog');
check('modal de confirmación abierto', await modal.isVisible());
await modal.getByRole('button', { name: 'Confirmar retorno' }).click();
await modal.waitFor({ state: 'detached' });

const badge = fila.getByText(/^DEVUELTO el \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
await badge.waitFor();
check('badge "DEVUELTO el DD/MM/YYYY HH:mm"', await badge.isVisible(), await fila.innerText());
check('el botón desaparece tras el retorno', (await fila.getByRole('button', { name: 'Registrar retorno' }).count()) === 0);
if (SHOT) await page.screenshot({ path: `${SHOT}-orders.png`, fullPage: false });

await page.goto(`${WEB}/admin/vehiculos`, { waitUntil: 'domcontentloaded' });
const filaV = page.locator('tr', { hasText: vehicleId });
await filaV.waitFor();
const enLavado = filaV.locator('.badge-warning', { hasText: 'En lavado' });
check('vehículo con badge amarillo "En lavado"', await enLavado.isVisible(), await filaV.innerText());
check('muestra hasta cuándo está en lavado', /hasta \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(await filaV.innerText()));
if (SHOT) await filaV.screenshot({ path: `${SHOT}-vehiculos.png` });

await browser.close();
console.log(`\n${fail ? '❌' : '✅'} ${ok} ok, ${fail} fallas`);
process.exit(fail ? 1 : 0);
