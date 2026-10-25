/**
 * E2E de UI del Reto 2 en Chrome real, sobre el contrato /api/v2:
 *   cliente: reserva (API v2) -> Mis reservas: 3 fases + check-in digital + voucher QR
 *   admin:   Mostrador (entrega con km_salida, devolucion con km_retorno) -> Flota (cronometro 2 h)
 *            -> Salud (semaforo LED + feed outbox) -> Promociones B2B -> Mantenimiento
 *
 * Deja un vehiculo EN_LIMPIEZA 2 h (es el comportamiento esperado): por eso apunta por defecto a local.
 * Uso:  node frontend/scripts/e2e-reto2.mjs [WEB] [API_V2]
 *       (por defecto http://localhost:5173 y http://localhost:3000/api/v2)
 */
import { chromium } from 'playwright-core';

const WEB = process.argv[2] || 'http://localhost:5173';
const API = process.argv[3] || 'http://localhost:3000/api/v2';
const API_V1 = API.replace(/\/api\/v2$/, '/api/v1');
const SHOTS = process.env.SHOTS_DIR || '';
let ok = 0, fail = 0;
const check = (n, c, x = '') => { c ? (ok++, console.log(`  ✔ ${n}`)) : (fail++, console.log(`  ✘ ${n} ${x}`)); };

const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(60_000);
page.on('pageerror', (e) => { fail++; console.log('  [pageerror]', e.message); });
const foto = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }); };

const token = async (email, password) => {
  const r = await page.request.post(`${API_V1}/auth/token`, { data: { email, password } });
  return (await r.json()).access_token;
};
const login = async (email, password) => {
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
};
const fecha = (dias) => new Date(Date.now() - 5 * 3600e3 + dias * 86400e3).toISOString().slice(0, 10);

try {
  console.log(`\n# ${WEB} (API ${API})`);

  console.log('\n# Reserva por la API v2 (maria)');
  const tMaria = await token('maria@example.com', 'Cliente12345');
  const autos = await (await page.request.get(`${API}/autos?limit=50`)).json();
  const auto = autos.data[0];
  check('hay un vehiculo DISPONIBLE en GET /autos', !!auto, JSON.stringify(autos).slice(0, 120));
  const crear = await page.request.post(`${API}/autos/orders/create`, {
    headers: { Authorization: `Bearer ${tMaria}`, 'Idempotency-Key': crypto.randomUUID() },
    data: {
      vehicle_id: auto.vehicle_id, pickup_date: fecha(1), dropoff_date: fecha(3), hora_recogida: '09:30', hora_devolucion: '09:30',
      tipo_cobertura: 'TOTAL',
      conductor: { nombre: 'María Maldonado', email: 'maria@example.com', telefono: '0983563584', licencia_conducir: '1712345678', edad: 30 },
    },
  });
  const orden = await crear.json();
  check('POST /autos/orders/create -> 201', crear.status() === 201, crear.status());
  const pnr = orden.pnr;
  console.log(`    PNR ${pnr} · ${auto.marca} ${auto.modelo}`);

  console.log('\n# Mis reservas: fases + check-in digital + QR');
  await login('maria@example.com', 'Cliente12345');
  await page.goto(`${WEB}/mis-reservas`, { waitUntil: 'domcontentloaded' });
  const tarjeta = page.locator('.card', { has: page.locator('code', { hasText: pnr }) });
  await tarjeta.waitFor();
  check('muestra las 3 fases de check-in', (await tarjeta.getByRole('list', { name: 'Fases de check-in' }).locator('li').count()) === 3);
  await tarjeta.getByRole('button', { name: 'Check-in digital' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Documento de identidad *').fill('1712345678');
  await dlg.getByLabel('Vencimiento de la licencia *').fill('2030-12-31');
  await dlg.getByRole('button', { name: 'Hacer check-in' }).click();
  await page.getByText(`Check-in digital listo para ${pnr}`).waitFor();
  check('check-in digital completado', true);
  await tarjeta.getByText(/1\. Check-in digital · \d/).waitFor();
  check('fase 1 con su timestamp', true);
  await tarjeta.getByRole('button', { name: 'Voucher QR' }).click();
  check('voucher QR fast-track', await page.getByRole('dialog').locator('img[alt^="Voucher QR"]').isVisible());
  await foto('01-mis-reservas');
  await page.keyboard.press('Escape');

  console.log('\n# Mostrador (admin): entrega y devolucion');
  await login('admin@rentafacil.ec', 'Admin12345');
  await page.goto(`${WEB}/admin/mostrador?pnr=${pnr}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Check-in de entrega' }).waitFor();
  await page.getByLabel('Licencia física presentada *').fill('0000000000');
  const kmIni = Number(await page.getByLabel('Odómetro de salida (km) *').inputValue() || 0);
  await page.getByRole('button', { name: 'Entregar llaves' }).click();
  await page.getByText('no coincide').waitFor();
  check('licencia distinta -> error del backend (LICENSE_MISMATCH)', true);
  await page.getByLabel('Licencia física presentada *').fill('1712345678');
  await page.getByRole('button', { name: 'Entregar llaves' }).click();
  await page.getByText(/Llaves entregadas/).waitFor();
  check('entrega registrada (ENTREGADO)', true);
  await page.getByRole('heading', { name: 'Check-in de devolución' }).waitFor();
  await page.getByLabel('Odómetro de retorno (km) *').fill(String(kmIni + 320));
  check('muestra el recorrido calculado', await page.getByText('Recorrido: 320 km').isVisible());
  await page.getByRole('button', { name: /Recibir vehículo/ }).click();
  await page.getByText(/Devolución registrada: 320 km recorridos/).waitFor();
  check('devolucion: 320 km recorridos y limpieza 2 h', true);
  await foto('02-mostrador');

  console.log('\n# Flota: cronometro de 2 h');
  await page.goto(`${WEB}/admin/flota`, { waitUntil: 'domcontentloaded' });
  const fila = page.locator('tr', { has: page.locator('code', { hasText: auto.vehicle_id }) });
  await fila.getByText('En limpieza').waitFor();
  const t1 = await fila.locator('[aria-label^="Faltan"]').textContent();
  await page.waitForTimeout(2200);
  const t2 = await fila.locator('[aria-label^="Faltan"]').textContent();
  check('cronometro cerca de 02:00:00', /^0[12]:[0-5]\d:[0-5]\d$/.test(t1 || ''), t1);
  check('el cronometro corre en vivo', t1 !== t2, `${t1} -> ${t2}`);
  await foto('03-flota');

  console.log('\n# Salud: semaforo LED + outbox');
  await page.goto(`${WEB}/admin/health`, { waitUntil: 'domcontentloaded' });
  await page.getByText('NODE_AUT_RENTAFACIL').waitFor();
  check('LED verde (HEALTHY)', await page.getByRole('img', { name: /Semáforo: Verde/ }).isVisible());
  await page.getByText('auto.cooldown.started').first().waitFor();
  check('feed outbox con auto.cooldown.started', true);
  await foto('04-salud');

  console.log('\n# Promociones B2B');
  await page.goto(`${WEB}/admin/promociones`, { waitUntil: 'domcontentloaded' });
  await page.getByText('NODE_AUT_LOCAL').waitFor();
  const pct = page.getByLabel('2. Porcentaje máximo de descuento (%) *');
  const anterior = await pct.inputValue();
  await pct.fill('150');
  check('valida 0-100', await page.getByText('Porcentaje entre 0 y 100').isVisible());
  await pct.fill(anterior);
  await page.getByRole('button', { name: 'Formalizar acuerdo' }).click();
  await page.getByText('Acuerdo B2B de promociones y combos actualizado exitosamente.').waitFor();
  check('PUT /promociones/contrato con JWT admin', true);
  await foto('05-promociones');

  console.log('\n# Mantenimiento (tecnico)');
  await login('tecnico@rentafacil.ec', 'Tecnico12345');
  await page.goto(`${WEB}/admin`, { waitUntil: 'domcontentloaded' });
  const redirigido = await page.waitForURL(/\/admin\/flota/, { timeout: 10_000 }).then(() => true, () => false);
  check('el tecnico (MANTENIMIENTO) entra directo a la flota', redirigido, page.url());
  await page.goto(`${WEB}/admin/mantenimiento?id=${auto.vehicle_id}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Registrar en bitácora' }).click();
  await page.getByText(/bitácora BIT-AUTO-/).waitFor();
  check('registro en bitacora', true);
  await page.goto(`${WEB}/admin/promociones`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL((u) => u.pathname === '/');
  check('el tecnico no accede a promociones', true);
  await foto('06-mantenimiento');
} catch (e) {
  fail++; console.error('ERROR', e.message);
  await page.screenshot({ path: 'e2e-reto2-error.png', fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  console.log(`\nResultado: ${ok} OK, ${fail} fallos`);
  process.exit(fail ? 1 : 0);
}
