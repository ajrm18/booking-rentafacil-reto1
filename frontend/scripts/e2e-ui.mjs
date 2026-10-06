/**
 * E2E de UI en Chrome real: reserva completa con el simulador de pagos.
 *   / -> Catalogo -> vehiculo -> preview -> modal de pago -> "Usar tarjeta de prueba"
 *   -> "Pagar ahora" -> confirmacion con localizador RENTAFACIL-...
 * Ademas comprueba la accesibilidad del modal (foco inicial, focus trap, Escape) y Luhn.
 *
 * Uso:  node frontend/scripts/e2e-ui.mjs [URL]   (por defecto produccion en Vercel)
 * Requiere playwright-core (npm i -D playwright-core) y Google Chrome instalado.
 */
import { chromium } from 'playwright-core';

const WEB = process.argv[2] || 'https://booking-rentafacil-reto1.vercel.app';
const HEADLESS = process.env.HEADED ? false : true;
let ok = 0, fail = 0;
const check = (n, c, x = '') => { c ? (ok++, console.log(`  ✔ ${n}`)) : (fail++, console.log(`  ✘ ${n} ${x}`)); };

const browser = await chromium.launch({ channel: 'chrome', headless: HEADLESS });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(90_000); // Render Free puede tardar en despertar
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
// URL del backend que usa el frontend desplegado (se toma de la primera llamada a /api/v1)
let apiBase = '';
page.on('request', (r) => { const m = /^(.*\/api\/v1)\//.exec(r.url()); if (m && !apiBase) apiBase = m[1]; });
const activo = () => page.evaluate(() => {
  const e = document.activeElement;
  return { dentro: !!e?.closest('[role="dialog"]'), label: e?.id ? document.querySelector(`label[for="${e.id}"]`)?.textContent : e?.textContent?.trim() };
});

try {
  console.log(`\n# ${WEB}`);
  console.log('\n# Login (cliente demo)');
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').fill('maria@example.com');
  await page.locator('input[type="password"]').fill('Cliente12345');
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  check('sesion iniciada', true);

  console.log('\n# Inicio -> Catalogo -> vehiculo');
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.locator('.nav-desktop').getByRole('link', { name: 'Catálogo' }).click();
  await page.waitForURL(/\/catalogo/);
  const card = page.locator('.veh-card-link').first();
  await card.waitFor();
  await card.click();
  await page.waitForURL(/\/vehiculos\//);
  check('detalle del vehiculo abierto', true);

  console.log('\n# Preview');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('heading', { name: 'Confirmar reserva' }).waitFor();
  const nombre = page.locator('aside input').first();
  await nombre.fill('Maria');
  await page.locator('aside input').nth(1).fill('Prueba');
  check('preview generado', true);

  console.log('\n# Simulador de pago');
  await page.getByRole('button', { name: 'Confirmar reserva' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const totalTxt = await dialog.locator('.pay-total').textContent();
  check('muestra "Pagar $X USD"', /^Pagar \$\d+\.\d{2} USD$/.test(totalTxt?.trim() || ''), totalTxt);
  check('banner de modo simulador visible', await dialog.getByText('Modo simulador').isVisible());
  let a = await activo();
  check('al abrir, el foco va al primer campo', a.label === 'Número de tarjeta', JSON.stringify(a));

  // Focus trap: 15 Tabs y 15 Shift+Tabs nunca salen del modal
  let fuera = false;
  for (let i = 0; i < 15; i++) { await page.keyboard.press('Tab'); if (!(await activo()).dentro) fuera = true; }
  for (let i = 0; i < 15; i++) { await page.keyboard.press('Shift+Tab'); if (!(await activo()).dentro) fuera = true; }
  check('focus trap: Tab/Shift+Tab no salen del modal', !fuera);

  await page.keyboard.press('Escape');
  check('Escape cierra el modal', await dialog.count() === 0);
  await page.getByRole('button', { name: 'Confirmar reserva' }).click();
  await dialog.waitFor();

  // Validaciones: tarjeta que no pasa Luhn, fecha vencida, CVV corto
  await dialog.getByLabel('Número de tarjeta').fill('4111111111111112');
  check('mascara 4-4-4-4', (await dialog.getByLabel('Número de tarjeta').inputValue()) === '4111 1111 1111 1112');
  await dialog.getByLabel('Nombre del titular').fill('Ma');
  await dialog.getByLabel('Fecha de expiración').fill('0120');
  check('mascara MM/AA', (await dialog.getByLabel('Fecha de expiración').inputValue()) === '01/20');
  await dialog.getByLabel('CVV').fill('12');
  await dialog.getByRole('button', { name: 'Pagar ahora' }).click();
  const errs = (await dialog.locator('.pay-err').allTextContents()).join(' | ');
  check('valida Luhn, titular, expiracion vencida y CVV', /inválido/.test(errs) && /Mínimo 3/.test(errs) && /vencida/.test(errs) && /3 dígitos/.test(errs), errs);

  // Tarjeta de prueba y pago
  await dialog.getByRole('button', { name: 'Usar tarjeta de prueba' }).click();
  check('autollena tarjeta de prueba', (await dialog.getByLabel('Número de tarjeta').inputValue()) === '4111 1111 1111 1111'
    && (await dialog.getByLabel('Fecha de expiración').inputValue()) === '12/30' && (await dialog.getByLabel('CVV').inputValue()) === '123');
  const t0 = Date.now();
  await dialog.getByRole('button', { name: 'Pagar ahora' }).click();
  check('muestra "Procesando pago..."', await dialog.getByText('Procesando pago...').first().isVisible());

  console.log('\n# Confirmacion');
  await page.waitForURL(/\/reserva\//);
  check('espera ~2 s de procesamiento simulado', Date.now() - t0 >= 2000, `${Date.now() - t0} ms`);
  const loc = page.locator('code', { hasText: 'RENTAFACIL-' });
  await loc.waitFor();
  const locator = (await loc.textContent())?.trim();
  check('pantalla de confirmacion con localizador RENTAFACIL-', /^RENTAFACIL-[A-Z0-9]+$/.test(locator || ''), locator);
  console.log(`    localizador: ${locator}  orden: ${page.url().split('/reserva/')[1]}`);

  // Limpieza: cancelar la reserva de prueba para no dejar el vehiculo RESERVED
  const orderId = page.url().split('/reserva/')[1];
  const tok = await page.evaluate(() => localStorage.getItem('rf_token'));
  if (orderId && tok && apiBase) {
    const r = await page.request.post(`${apiBase}/orders/${orderId}/cancel`, {
      headers: { Authorization: `Bearer ${tok}`, 'Idempotency-Key': crypto.randomUUID() },
    });
    check('limpieza: reserva de prueba cancelada', r.status() === 200, r.status());
  }
} catch (e) {
  fail++; console.error('ERROR', e.message);
  await page.screenshot({ path: 'e2e-ui-error.png', fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  console.log(`\nResultado: ${ok} OK, ${fail} fallos`);
  process.exit(fail ? 1 : 0);
}
