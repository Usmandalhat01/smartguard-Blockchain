const { chromium } = require('playwright');
const ACC = JSON.parse(require('fs').readFileSync('deployed.json')).accounts; // buyer, seller, arbitrator, admin
const RPC = 'http://127.0.0.1:8545';
let id = 1;
async function rpc(method, params) {
  const r = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params: params || [] }) })).json();
  if (r.error) throw new Error(r.error.message);
  return r.result;
}
const log = (...a) => console.log(...a);

async function session(browser, email, password, account) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await page.exposeFunction('__rpc', async (method, params) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
    if (method === 'wallet_switchEthereumChain') return null;
    if (method === 'eth_sendTransaction') { params[0].gas = '0x7a120'; }
    return rpc(method, params);
  });
  await page.addInitScript(() => { window.ethereum = { request: ({ method, params }) => window.__rpc(method, params) }; });
  page.on('pageerror', (e) => log('  [pageerror]', e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') log('  [console.error]', m.text().slice(0, 200)); });
  await page.goto('http://localhost:3000/login');
  await page.fill('#email', email); await page.fill('#password', password);
  await page.click('button[type=submit]');
  await page.waitForURL(/escrows|disputes|admin/, { timeout: 30000 });
  return page;
}


const sqlite = (q) => require('child_process').execSync(`python3 -c "import sqlite3,json;c=sqlite3.connect('e2e.sqlite');print(json.dumps(c.execute(\\"${q}\\").fetchall()))"`).toString();
const dbState = (ref) => JSON.parse(sqlite(`select state,outcome from transactions where reference='${ref}'`))[0];
const expect = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); log(ok ? 'PASS' : 'FAIL', label, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitDb(ref, state, ms = 40000) { const end = Date.now() + ms; while (Date.now() < end) { const s = dbState(ref); if (s[0] === state) return s; await sleep(2000); } return dbState(ref); }

async function openEscrow(buyer, item) {
  await buyer.goto('http://localhost:3000/escrows/new');
  await buyer.waitForSelector('text=Counterparty'); await buyer.waitForTimeout(1500);
  await buyer.fill('#amount', '0.25'); await buyer.fill('#item', item);
  await buyer.click('text=Run risk assessment');
  await buyer.waitForSelector('text=/Deposit .* into escrow/', { timeout: 30000 });
  await buyer.click('text=/Deposit .* into escrow/');
  await buyer.waitForSelector('text=View escrow', { timeout: 120000 });
  await buyer.click('text=View escrow'); await buyer.waitForURL(/escrows\/ESC-/);
  return buyer.url().split('/').pop();
}
const act = async (page, ref, label) => {
  await page.goto(`http://localhost:3000/escrows/${ref}`); await page.waitForTimeout(2500);
  await page.click(`button:has-text("${label}")`, { timeout: 20000 });
};

(async () => {
  const browser = await chromium.launch();
  const buyer = await session(browser, 'amina.yusuf@example.ng', 'buyer-demo-2026', ACC[0]);
  const seller = await session(browser, 'tunde.okafor@example.ng', 'seller-demo-2026', ACC[1]);
  const arb = await session(browser, 'n.eze@arbitration.ng', 'arbitrator-demo-2026', ACC[2]);

  // A: deposit -> confirm -> time lock -> seller withdraws
  const A = await openEscrow(buyer, 'Case A: laptop, sealed box, Abuja pickup');
  expect('A deposit recorded', await waitDb(A, 'INITIATED'), ['INITIATED', null]);
  await act(buyer, A, 'Confirm receipt');
  expect('A delivered', await waitDb(A, 'DELIVERED'), ['DELIVERED', null]);
  await sleep(33000);
  await act(seller, A, 'Withdraw');
  expect('A completed, released to seller', await waitDb(A, 'COMPLETED'), ['COMPLETED', 'RELEASED_TO_SELLER']);

  // B: deposit -> seller disputes -> arbitrator rules for buyer
  const B = await openEscrow(buyer, 'Case B: phone, unopened, Lagos delivery');
  await act(seller, B, 'Dispute');
  await seller.fill('textarea', 'Buyer has not collected the item and is refusing to confirm receipt.');
  await seller.click('button:has-text("Submit dispute")');
  expect('B disputed', await waitDb(B, 'DISPUTED'), ['DISPUTED', null]);
  await arb.goto('http://localhost:3000/disputes'); await arb.waitForTimeout(3000);
  await arb.click('text=Resolve case', { timeout: 20000 });
  await arb.click('button:has-text("Refund to buyer")');
  await arb.fill('textarea', 'Seller supplied no proof of dispatch; returning the funds to the buyer.');
  await arb.click('button:has-text("Execute ruling")');
  expect('B resolved for buyer', await waitDb(B, 'COMPLETED'), ['COMPLETED', 'RESOLVED_FOR_BUYER']);

  // C: deposit -> holding period passes -> buyer claims refund
  const C = await openEscrow(buyer, 'Case C: camera, never shipped, Kano');
  await sleep(63000);
  await act(buyer, C, 'Claim refund');
  expect('C refunded after holding period', await waitDb(C, 'COMPLETED'), ['COMPLETED', 'TIMEOUT_REFUND']);

  // idempotency: a second sync pass over everything changes nothing
  const before = sqlite('select count(*) from audit_log');
  await sleep(6000);
  expect('no duplicate audit rows after more sync passes', sqlite('select count(*) from audit_log'), before);
  await buyer.goto(`http://localhost:3000/escrows/${A}`); await buyer.waitForTimeout(2500);
  await buyer.screenshot({ path: 'shot_final.png', fullPage: true });
  await browser.close();
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
