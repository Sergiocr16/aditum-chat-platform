// Verificación headless del ciclo de vida de conversaciones:
// hilo continuo + infinite scroll (widget) · modal resolver + Resueltas + reabrir (consola).
import puppeteer from 'puppeteer-core';

const OUT = process.env.OUT_DIR ?? '/tmp';
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log('  ✔', n); };
const bad = (n) => { fail++; console.log('  ✘', n); };

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-first-run'],
});

// ---------- WIDGET: hilo continuo + infinite scroll ----------
console.log('WIDGET:');
const w = await browser.newPage();
await w.setViewport({ width: 1440, height: 900 });
await w.goto('http://127.0.0.1:5174/demo/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
await w.waitForSelector('pierce/.ac-bubble', { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));
await (await w.$('pierce/.ac-bubble')).click();
await w.waitForSelector('pierce/.ac-home', { timeout: 15000 });
const acciones = await w.$$('pierce/.ac-accion');
await acciones[0].click();
await w.waitForSelector('pierce/.ac-chat', { timeout: 15000 });
// Espera a que haya burbujas (la suscripción tarda un momento).
const count = async () => (await w.$$('pierce/.ac-burbuja')).length;
for (let i = 0; i < 20 && (await count()) === 0; i++) await new Promise((r) => setTimeout(r, 500));
const antes = await count();
antes > 0 && antes < 20 ? ok(`carga inicial acotada (${antes} burbujas)`) : bad(`carga inicial rara (${antes})`);

async function scrollTop() {
  const body = await w.$('pierce/.ac-chat-body');
  await body.evaluate((el) => { el.scrollTop = 0; });
  await new Promise((r) => setTimeout(r, 1500));
}
await scrollTop();
const tras1 = await count();
tras1 > antes ? ok(`infinite scroll cargó más (${antes} → ${tras1})`) : bad(`no cargó más (${antes} → ${tras1})`);
await scrollTop();
await scrollTop();
const tras3 = await count();
tras3 > tras1 ? ok(`siguió paginando (${tras1} → ${tras3})`) : bad(`no siguió paginando (${tras1} → ${tras3})`);

const sepConv = await w.$$('pierce/.ac-sep-conv');
sepConv.length > 0 ? ok('separador de conversación resuelta visible') : bad('sin separador de conversación');
const sepTxt = sepConv.length ? await sepConv[0].evaluate((e) => e.textContent) : '';
sepTxt.includes('Reservas') ? ok(`separador con categoría: "${sepTxt.trim()}"`) : bad(`separador sin categoría: "${sepTxt}"`);
await w.screenshot({ path: `${OUT}/l1-widget-hilo.png` });

// ---------- CONSOLA: resolver con modal + Resueltas + reabrir ----------
console.log('CONSOLA:');
const d = await browser.newPage();
await d.setViewport({ width: 1512, height: 950 });
await d.goto('http://127.0.0.1:3000/login', { waitUntil: 'networkidle2', timeout: 60000 });
await d.waitForSelector('input[type=email]', { timeout: 30000 });
await d.type('input[type=email]', 'partners@aditumcr.com');
await d.type('input[type=password]', 'aditum123');
await d.click('button[type=submit]');
await new Promise((r) => setTimeout(r, 2500));

const clickTexto = async (page, texto, opts = {}) => {
  const el = await page.evaluateHandle(
    (txt, exacto) =>
      [...document.querySelectorAll('button')].find((b) =>
        exacto ? b.textContent?.trim() === txt : b.textContent?.trim().includes(txt),
      ),
    texto,
    Boolean(opts.exacto),
  );
  if (!el || !(await el.asElement())) return false;
  await el.asElement().click();
  return true;
};

// Abrir la conversación de Juan
(await clickTexto(d, 'Juan Rodríguez')) ? ok('conversación de Juan abierta') : bad('no encontró a Juan');
await new Promise((r) => setTimeout(r, 1500));

// Panel de contexto: conversaciones anteriores
const tieneAnteriores = await d.evaluate(() => document.body.textContent.includes('CONVERSACIONES ANTERIORES'));
tieneAnteriores ? ok('panel muestra CONVERSACIONES ANTERIORES') : bad('sin sección de anteriores');

// Ver conversación completa (la vieja resuelta)
if (await clickTexto(d, 'Ver conversación completa')) {
  await new Promise((r) => setTimeout(r, 1500));
  const barra = await d.evaluate(() => document.body.textContent.includes('Conversación resuelta'));
  barra ? ok('vista completa en modo resuelto (barra + Reabrir)') : bad('no mostró barra de resuelta');
  await d.screenshot({ path: `${OUT}/l2-ver-completa.png` });
} else bad('sin botón Ver conversación completa');

// Volver a la activa de Juan y resolverla con el modal
await clickTexto(d, 'Juan Rodríguez');
await new Promise((r) => setTimeout(r, 1200));
const resolverBtn = await d.$('button[title="Resolver"], button[title="Resolve"]');
if (resolverBtn) { await resolverBtn.click(); ok('click en resolver'); } else bad('sin botón resolver');
await new Promise((r) => setTimeout(r, 800));
const modalVisible = await d.evaluate(() => document.body.textContent.includes('¿Marcar esta conversación como resuelta?'));
modalVisible ? ok('modal de confirmación visible') : bad('modal no apareció');
await d.screenshot({ path: `${OUT}/l3-modal-resolver.png` });
(await clickTexto(d, 'Cobros', { exacto: true })) ? ok('categoría Cobros seleccionada') : bad('no encontró chip Cobros');
await new Promise((r) => setTimeout(r, 400));
(await clickTexto(d, 'Resolver conversación', { exacto: true })) ? ok('confirmado') : bad('no encontró confirmar');
await new Promise((r) => setTimeout(r, 2500));

// La conversación sale del inbox activo
const sigueEnLista = await d.evaluate(() => {
  const filas = [...document.querySelectorAll('section button')];
  return filas.some((f) => f.textContent?.includes('Juan Rodríguez') && f.textContent?.includes('ABIERTA'));
});
!sigueEnLista ? ok('salió del inbox activo') : bad('sigue en el inbox activo');

// Aparece en Resueltas con chip de categoría
await clickTexto(d, 'Resueltas');
await new Promise((r) => setTimeout(r, 1500));
const enResueltas = await d.evaluate(() => {
  const filas = [...document.querySelectorAll('section button')];
  const f = filas.find((x) => x.textContent?.includes('Juan Rodríguez'));
  return f ? f.textContent.includes('COBROS') : false;
});
enResueltas ? ok('en pestaña Resueltas con chip COBROS') : bad('no aparece en Resueltas con categoría');
await d.screenshot({ path: `${OUT}/l4-resueltas.png` });

// Abrir y reabrir
await clickTexto(d, 'Juan Rodríguez');
await new Promise((r) => setTimeout(r, 1200));
(await clickTexto(d, 'Reabrir conversación')) ? ok('reabrir disponible y clickeado') : bad('sin botón reabrir');
await new Promise((r) => setTimeout(r, 1500));
const composerVolvio = await d.evaluate(() => document.body.textContent.includes('Enter para enviar'));
composerVolvio ? ok('composer de vuelta tras reabrir') : bad('composer no volvió');

await browser.close();
console.log(`\nResultado: ${pass} ✔ · ${fail} ✘`);
process.exit(fail ? 1 : 0);
