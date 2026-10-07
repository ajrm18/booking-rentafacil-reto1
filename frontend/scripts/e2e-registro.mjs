/**
 * E2E de UI en Chrome real: registro público de clientes.
 *  1. "Registrarse" de la barra lleva a /registro; el formulario valida campos obligatorios,
 *     filtra lo que no se puede escribir (letras en teléfono, números en nombre, dos @) y
 *     rechaza cédula inválida y contraseñas que no coinciden.
 *  2. Registro válido: la sesión queda iniciada como cliente (sin enlace Admin).
 *  3. Correo y cédula repetidos los rechaza el servidor; la API no deja registrarse como admin.
 *  4. La cuenta nueva puede ingresar desde /login; los enlaces Ingresar <-> Registrarse funcionan.
 *  5. Un visitante que quiere reservar se registra y vuelve al vehículo con el conductor autollenado.
 * Al final se eliminan los usuarios de prueba (como admin).
 *
 * Uso:  node frontend/scripts/e2e-registro.mjs [URL]   (por defecto producción en Vercel)
 */
import { chromium } from 'playwright-core';

const WEB = process.argv[2] || 'https://booking-rentafacil-reto1.vercel.app';
let ok = 0, fail = 0;
const check = (n, c, x = '') => { c ? (ok++, console.log(`  ✔ ${n}`)) : (fail++, console.log(`  ✘ ${n} ${x}`)); };

/** Cédula ecuatoriana válida y aleatoria (provincia 17, dígito verificador módulo 10). */
function cedulaAleatoria() {
  const base = '17' + Math.floor(Math.random() * 6) + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  const suma = [...base].reduce((s, d, i) => { let n = Number(d) * (i % 2 === 0 ? 2 : 1); if (n > 9) n -= 9; return s + n; }, 0);
  return base + ((10 - (suma % 10)) % 10);
}
const sello = Date.now();
const ANA = { nombre: 'Ana María', apellido: 'Registro', email: `ana.registro.${sello}@test.com`, telefono: '0983563584', cedula: cedulaAleatoria(), password: 'Registro123' };
const LUIS = { nombre: 'Luis', apellido: 'Visitante', email: `luis.visitante.${sello}@test.com`, telefono: '+593 98 111 2222', cedula: cedulaAleatoria(), password: 'Visitante123' };
const fecha = (dias) => { const d = new Date(Date.now() + dias * 864e5); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(90_000); // Render Free puede tardar en despertar
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
let apiBase = '';
page.on('request', (r) => { const m = /^(.*\/api\/v1)\//.exec(r.url()); if (m && !apiBase) apiBase = m[1]; });

const campo = (label) => page.getByLabel(label, { exact: true });
const errores = () => page.locator('form [role="alert"]');
async function llenar(u) {
  await campo('Nombre *').fill(u.nombre);
  await campo('Apellido *').fill(u.apellido);
  await campo('Correo electrónico *').fill(u.email);
  await campo('Teléfono *').fill(u.telefono);
  await campo('Cédula *').fill(u.cedula);
  await campo('Contraseña *').fill(u.password);
  await campo('Confirmar contraseña *').fill(u.password);
}
async function logout() {
  await page.locator('.nav-desktop').getByRole('button', { name: 'Salir' }).click();
  await page.waitForURL((u) => u.pathname === '/');
}
const sesion = () => page.evaluate(() => JSON.parse(localStorage.getItem('rf_user') || 'null'));

try {
  console.log(`\n# ${WEB}`);
  console.log('\n# Formulario de registro');
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.locator('.nav-desktop').getByRole('link', { name: 'Registrarse' }).click();
  await page.waitForURL(/\/registro$/);
  check('"Registrarse" de la barra abre /registro', await page.getByRole('heading', { name: 'Crear cuenta' }).isVisible());

  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  check('valida los 6 campos obligatorios', (await errores().count()) === 6, String(await errores().count()));
  check('el foco va al primer campo con error', await page.evaluate(() => document.activeElement?.id) === 'reg-first_name');

  await campo('Nombre *').pressSequentially('Ana2#');
  check('el nombre no admite números ni símbolos', (await campo('Nombre *').inputValue()) === 'Ana');
  await campo('Teléfono *').pressSequentially('09abc83');
  check('el teléfono no admite letras', (await campo('Teléfono *').inputValue()) === '0983');
  await campo('Correo electrónico *').pressSequentially('a b@@c.com');
  check('el correo no admite espacios ni una segunda @', (await campo('Correo electrónico *').inputValue()) === 'ab@c.com');
  await campo('Cédula *').pressSequentially('12ab34567890');
  check('la cédula solo admite 10 dígitos', (await campo('Cédula *').inputValue()) === '1234567890');

  await llenar({ ...ANA, cedula: '1234567890' });
  await campo('Confirmar contraseña *').fill('OtraClave123');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  check('rechaza cédula con dígito verificador incorrecto', await page.getByText('La cédula no es válida').isVisible());
  check('rechaza contraseñas que no coinciden', await page.getByText('Las contraseñas no coinciden').isVisible());
  await campo('Contraseña *').fill('corta');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  check('rechaza contraseña de menos de 8 caracteres', await page.getByText('La contraseña debe tener al menos 8 caracteres').isVisible());

  console.log('\n# Registro válido');
  await llenar(ANA);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.waitForURL(/\/catalogo/);
  const u = await sesion();
  check('tras registrarse entra directamente (va al catálogo)', u?.email === ANA.email, JSON.stringify(u));
  check('queda con rol cliente', u?.role === 'client');
  check('la barra muestra su nombre y no el enlace Admin',
    (await page.locator('.nav-desktop').textContent()).includes('Ana María') &&
    (await page.locator('.nav-desktop').getByRole('link', { name: 'Admin' }).count()) === 0);
  await logout();

  console.log('\n# Duplicados y seguridad');
  await page.goto(`${WEB}/registro`, { waitUntil: 'domcontentloaded' });
  await llenar({ ...ANA, email: ANA.email.toUpperCase().replace('@TEST.COM', '@test.com'), cedula: cedulaAleatoria() });
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  check('correo repetido (sin importar mayúsculas): lo rechaza el servidor',
    await page.getByText('Ya existe un usuario con ese correo').waitFor({ timeout: 30_000 }).then(() => true, () => false));
  await llenar({ ...ANA, email: `otra.${sello}@test.com` });
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  check('cédula repetida: la rechaza el servidor',
    await page.getByText('Ya existe un usuario con esa cédula').waitFor({ timeout: 30_000 }).then(() => true, () => false));
  const comoAdmin = await page.request.post(`${apiBase}/auth/register`, {
    data: { first_name: 'Eva', last_name: 'Intrusa', email: `eva.${sello}@test.com`, phone: '0991234567', national_id: cedulaAleatoria(), password: 'Intrusa123', role: 'admin' },
  });
  check('la API no permite registrarse como admin (400)', comoAdmin.status() === 400, String(comoAdmin.status()));
  const sinCedula = await page.request.post(`${apiBase}/auth/register`, {
    data: { first_name: 'Eva', last_name: 'Intrusa', email: `eva.${sello}@test.com`, phone: '0991234567', password: 'Intrusa123' },
  });
  check('la API exige la cédula (400)', sinCedula.status() === 400, String(sinCedula.status()));

  console.log('\n# Ingresar con la cuenta nueva');
  await page.getByRole('link', { name: 'Ingresa aquí' }).click();
  await page.waitForURL(/\/login$/);
  check('"Ingresa aquí" lleva a /login', true);
  await page.getByLabel('Correo electrónico').fill(ANA.email);
  await page.getByLabel('Contraseña').fill(ANA.password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((x) => !x.pathname.startsWith('/login'));
  check('la cuenta registrada puede ingresar', (await sesion())?.email === ANA.email);
  await logout();

  console.log('\n# Visitante que quiere reservar');
  await page.goto(`${WEB}/catalogo?ini=${fecha(10)}&fin=${fecha(12)}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.veh-card-link').first().click();
  await page.waitForURL(/\/vehiculos\//);
  const vehiculo = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Ingresar para reservar' }).click();
  await page.waitForURL(/\/login$/);
  await page.getByRole('link', { name: 'Regístrate aquí' }).click();
  await page.waitForURL(/\/registro$/);
  check('desde Ingresar, "Regístrate aquí" lleva a /registro', true);
  await llenar(LUIS);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.waitForURL((x) => x.pathname === vehiculo);
  check('tras registrarse vuelve al vehículo que quería reservar', true);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('heading', { name: 'Confirmar reserva' }).waitFor();
  await page.waitForFunction(() => document.querySelector('aside input')?.value);
  check('el conductor se autollena con los datos del registro',
    (await page.locator('aside input').first().inputValue()) === LUIS.nombre &&
    (await page.locator('aside input').nth(1).inputValue()) === LUIS.apellido);
} catch (e) {
  fail++; console.error('ERROR', e.message);
  await page.screenshot({ path: 'e2e-registro-error.png', fullPage: true }).catch(() => {});
} finally {
  // Limpieza: el admin elimina los usuarios de prueba (el hold de la reserva sin confirmar expira solo)
  try {
    const t = await (await page.request.post(`${apiBase}/auth/token`, { data: { email: 'admin@rentafacil.ec', password: 'Admin12345' } })).json();
    const h = { Authorization: `Bearer ${t.access_token}` };
    const usuarios = await (await page.request.get(`${apiBase}/admin/users`, { headers: h })).json();
    const prueba = usuarios.filter((x) => x.email.endsWith(`.${sello}@test.com`));
    for (const x of prueba) await page.request.delete(`${apiBase}/admin/users/${x.user_id}`, { headers: h });
    console.log(`\n  limpieza: ${prueba.length} usuario(s) de prueba eliminados`);
  } catch (e) { console.log('  limpieza fallida:', e.message); }
  await browser.close();
  console.log(`\nResultado: ${ok} OK, ${fail} fallos`);
  process.exit(fail ? 1 : 0);
}
