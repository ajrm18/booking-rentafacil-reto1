import { randomUUID } from 'node:crypto';

// Por defecto producción; para probar en local: API_URL=http://localhost:3000 FRONT_URL=http://localhost:5173
const ORIGEN = process.env.API_URL || 'https://rentafacil-api.onrender.com';
const API = `${ORIGEN}/api/v1`;
const SWAGGER = `${ORIGEN}/api/docs`;
const FRONT = process.env.FRONT_URL || 'https://booking-rentafacil-reto1.vercel.app';

const G = (s) => `\x1b[32m${s}\x1b[0m`, R = (s) => `\x1b[31m${s}\x1b[0m`;
const ctx = {};

async function call(step, method, path, { body, headers = {}, timeout = 90000 } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, req: { method, path, headers, body } };
}

function check(step, cond, r, msg) {
  if (!cond) {
    console.log(R(`❌ ${step} FALLÓ: ${msg}`));
    console.log('REQUEST:', JSON.stringify(r.req, null, 2));
    console.log('RESPONSE:', r.status, JSON.stringify(r.json, null, 2));
    process.exit(1);
  }
  console.log(G(`✔ ${step}`), msg);
}

// Ventana aleatoria futura para evitar choques con reservas de ejecuciones previas
const offsetDays = 200 + Math.floor(Math.random() * 300);
const pick = new Date(Date.now() + offsetDays * 864e5); pick.setUTCHours(10, 0, 0, 0);
const drop = new Date(pick.getTime() + 3 * 864e5);

// 1
let r = await call('1', 'POST', '/auth/token', { body: { email: 'admin@rentafacil.ec', password: 'Admin12345' } });
check('1 auth/token', [200, 201].includes(r.status) && r.json.access_token, r, `token obtenido (role=${r.json.user?.role})`);
ctx.token = r.json.access_token;
const auth = { Authorization: `Bearer ${ctx.token}` };

// 1b. Registro público de clientes (fuera del contrato): entra directamente con rol client
const cedula = (() => {
  const base = '17' + Math.floor(Math.random() * 6) + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  const suma = [...base].reduce((s, d, i) => { let n = Number(d) * (i % 2 === 0 ? 2 : 1); if (n > 9) n -= 9; return s + n; }, 0);
  return base + ((10 - (suma % 10)) % 10);
})();
const nuevo = { first_name: 'Cliente', last_name: 'Registro', email: `e2e.registro.${Date.now()}@test.com`, phone: '0983563584', national_id: cedula, password: 'Registro123' };
r = await call('1b', 'POST', '/auth/register', { body: nuevo });
check('1b auth/register', r.status === 201 && r.json.access_token && r.json.user?.role === 'client', r, `cliente ${r.json.user?.email} registrado (role=${r.json.user?.role})`);
r = await call('1c', 'POST', '/auth/register', { body: { ...nuevo, national_id: '1710034065' } });
check('1c register duplicado', r.status === 400 && r.json.invalidParams?.[0]?.name === 'email', r, 'correo repetido -> 400');
r = await call('1d', 'POST', '/auth/register', { body: { ...nuevo, email: `x.${nuevo.email}`, role: 'admin' } });
check('1d register como admin', r.status === 400, r, 'enviar role -> 400');
r = await call('1e', 'POST', '/auth/token', { body: { email: nuevo.email, password: nuevo.password } });
check('1e login del registrado', [200, 201].includes(r.status) && r.json.user?.role === 'client', r, 'la cuenta nueva inicia sesión');
const usuarios = (await call('1f', 'GET', '/admin/users', { headers: auth })).json;
const creado = usuarios.find((u) => u.email === nuevo.email);
r = await call('1f', 'DELETE', `/admin/users/${creado?.user_id}`, { headers: auth });
check('1f limpieza', r.status === 204, r, 'el admin elimina al cliente de prueba');

// 2
r = await call('2', 'POST', '/search', {
  headers: { 'X-Affiliate-Id': '1' },
  body: {
    booker: { country: 'ec' }, currency: 'USD', driver: { age: 25 },
    route: {
      pickup: { datetime: pick.toISOString(), location: { airport: 'UIO' } },
      dropoff: { datetime: drop.toISOString(), location: { airport: 'UIO' } },
    },
  },
});
check('2 search', r.status === 200 && r.json.search_token && r.json.data?.length > 0, r,
  `${r.json.data?.length} vehículos, search_token=${r.json.search_token}`);
ctx.search_token = r.json.search_token;
ctx.vehicle_id = r.json.data[0].vehicle_id;

// 3
r = await call('3', 'POST', '/orders/hold', { headers: auth,
  body: { vehicle_id: ctx.vehicle_id, search_token: ctx.search_token, driver: { age: 25 } } });
check('3 orders/hold', [200, 201].includes(r.status) && r.json.hold_id && r.json.status === 'HELD', r, `hold_id=${r.json.hold_id}`);
ctx.hold_id = r.json.hold_id;

// 4
r = await call('4', 'POST', '/orders/preview', { headers: auth,
  body: { vehicle_id: ctx.vehicle_id, search_token: ctx.search_token, hold_id: ctx.hold_id, extras: ['GPS'] } });
check('4 orders/preview', [200, 201].includes(r.status) && r.json.data?.order_preview_id, r,
  `order_preview_id=${r.json.data?.order_preview_id} total=${r.json.data?.total_price} ${r.json.data?.currency}`);
ctx.order_preview_id = r.json.data.order_preview_id;

// 5
const idemKey = randomUUID();
const createBody = {
  order_preview_id: ctx.order_preview_id,
  payment_reference: `PAY-E2E-${Date.now()}`,
  driver_details: { first_name: 'Anthony', last_name: 'Rosero', email: 'e2e@rentafacil.ec', phone_number: '+593 99 000 0000' },
};
r = await call('5', 'POST', '/orders/create', { headers: { ...auth, 'Idempotency-Key': idemKey }, body: createBody });
const o5 = r.json.data ?? r.json;
check('5 orders/create', [200, 201].includes(r.status) && o5.order_id && o5.locator, r, `order_id=${o5.order_id} locator=${o5.locator}`);
ctx.order_id = o5.order_id; ctx.locator = o5.locator;

// 6
r = await call('6', 'GET', `/orders/${ctx.order_id}`, { headers: auth });
const o6 = r.json.data ?? r.json;
const l = o6._links || {};
check('6 GET order', r.status === 200 && o6.status === 'CONFIRMED' && l.self && l.modify && l.cancel, r,
  `status=${o6.status} _links=${Object.keys(l).join(',')}`);

// 7
r = await call('7', 'POST', '/orders/create', { headers: { ...auth, 'Idempotency-Key': idemKey }, body: createBody });
const o7 = r.json.data ?? r.json;
check('7 idempotencia', [200, 201].includes(r.status) && o7.order_id === ctx.order_id, r, `mismo order_id=${o7.order_id}`);

// 8
r = await call('8', 'POST', `/orders/${ctx.order_id}/cancel`, { headers: { ...auth, 'Idempotency-Key': randomUUID() } });
const o8 = r.json.data ?? r.json;
check('8 cancel', [200, 201].includes(r.status) && o8.status === 'CANCELLED', r, `status=${o8.status}`);

// Extras: Swagger y Frontend
const sw = await fetch(SWAGGER, { signal: AbortSignal.timeout(60000) });
const swOk = sw.status === 200;
console.log((swOk ? G('✔') : R('❌')) + ` Swagger ${SWAGGER} -> ${sw.status}`);
const fr = await fetch(FRONT, { signal: AbortSignal.timeout(60000) });
const frHtml = await fr.text();
const frOk = fr.status === 200 && /<div id="root">/.test(frHtml);
console.log((frOk ? G('✔') : R('❌')) + ` Frontend ${FRONT} -> ${fr.status}${frOk ? ' (index.html con #root)' : ''}`);
if (!swOk || !frOk) process.exit(1);

console.log('\n' + G(process.env.API_URL ? '✅ TODO FUNCIONA (entorno local)' : '✅ TODO FUNCIONA EN PRODUCCIÓN - URLs listas para presentar'));
console.log(G(`  Frontend: ${FRONT}`));
console.log(G(`  API:      ${API}`));
console.log(G(`  Swagger:  ${SWAGGER}`));
