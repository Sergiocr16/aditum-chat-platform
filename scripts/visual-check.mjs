// Capturas headless del widget y la consola para verificación visual.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const OUT = process.env.OUT_DIR;
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-first-run', '--disable-features=HttpsFirstBalancedModeAutoEnable,HttpsUpgrades'],
});

async function shot(page, name) {
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('✔', name);
}

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });

// ---------- WIDGET (demo host) ----------
await page.goto('http://127.0.0.1:5174/demo/index.html', { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('pierce/.ac-bubble', { timeout: 20000 });
await shot(page, 'w0-burbuja');

const bubble = await page.$('pierce/.ac-bubble');
await bubble.click();
await page.waitForSelector('pierce/.ac-home', { timeout: 15000 });
await shot(page, 'w1-inicio');

// Chat con bot (vista amplia 940)
const acciones = await page.$$('pierce/.ac-accion');
if (acciones[0]) {
  await acciones[0].click();
  await page.waitForSelector('pierce/.ac-chat', { timeout: 15000 });
  await shot(page, 'w2-chat-amplio');
  const back = await page.$('pierce/.ac-chat-header .ac-icon-btn');
  await back.click();
  await new Promise((r) => setTimeout(r, 500));
}

// Chat de equipo (grupo)
const acciones2 = await page.$$('pierce/.ac-accion');
const grupoBtn = acciones2[2] ?? acciones2[acciones2.length - 1];
if (grupoBtn) {
  await grupoBtn.click();
  await page.waitForSelector('pierce/.ac-chat', { timeout: 15000 });
  await shot(page, 'w3-grupo');
  const back = await page.$('pierce/.ac-chat-header .ac-icon-btn');
  await back.click();
  await new Promise((r) => setTimeout(r, 500));
}

// Tickets
const tabs = await page.$$('pierce/.ac-tab');
if (tabs[1]) {
  await tabs[1].click();
  await new Promise((r) => setTimeout(r, 1200));
  await shot(page, 'w4-tickets');
  const cards = await page.$$('pierce/.ac-tk-card');
  if (cards[0]) {
    await cards[0].click();
    await shot(page, 'w5-ticket-detalle');
  }
}

// ---------- CONSOLA ----------
async function login(p, email) {
  await p.goto('http://127.0.0.1:3000/login', { waitUntil: 'networkidle2', timeout: 60000 });
  await p.waitForSelector('input[type=email]', { timeout: 30000 });
  await p.type('input[type=email]', email);
  await p.type('input[type=password]', 'aditum123');
  await p.click('button[type=submit]');
  await p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
}

const dash = await browser.newPage();
await dash.setViewport({ width: 1512, height: 950 });
await dash.goto('http://127.0.0.1:3000/login', { waitUntil: 'networkidle2', timeout: 60000 });
await shot(dash, 'd0-login');

await login(dash, 'partners@aditumcr.com');
await new Promise((r) => setTimeout(r, 2000));
await shot(dash, 'd1-inbox');

// Abrir una conversación
const filas = await dash.$$('section button');
if (filas[5]) await filas[5].click().catch(() => {});
await new Promise((r) => setTimeout(r, 1200));
await shot(dash, 'd2-conversacion');

for (const [ruta, nombre] of [
  ['/tickets', 'd3-tickets'],
  ['/contactos', 'd4-contactos'],
  ['/reportes', 'd5-reportes'],
  ['/bot', 'd6-bot'],
  ['/configuracion', 'd7-configuracion'],
]) {
  await dash.goto(`http://127.0.0.1:3000${ruta}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));
  await shot(dash, nombre);
}

await browser.close();
console.log('LISTO');
