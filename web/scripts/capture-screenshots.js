/**
 * Captures the interface evidence for Chapter Four and the presentation.
 *
 * Appendix A and Table A1 record that for every tested scenario "the only
 * available artefact is aggregate count in Table 4.3 only", and that no
 * usability or interface evidence was retained at all. Screenshots are the
 * cheapest of those gaps to close and the only one a reader can check at a
 * glance.
 *
 * The shots are chosen to evidence claims, not to tour the application. The
 * most important one is the refusal: a buyer navigating to /admin is redirected
 * to /forbidden by the server, which is what Section 3.15.2 asserts and what a
 * front-end-only restriction could not do.
 *
 *   node scripts/capture-screenshots.js
 *
 * Requires the web app and the API to be running. Playwright drives the Google
 * Chrome already installed on the machine via `channel: 'chrome'`, because
 * Playwright cannot install its own Chromium build on this macOS version.
 */

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const WEB_URL = process.env.WEB_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:8000';

const OUT_DIR = path.resolve(__dirname, '../../docs/evidence/screenshots');

// A desktop viewport at 2x, so the images stay legible when a document scales
// them down to a column width.
const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2;

const ACCOUNTS = {
  buyer: { email: 'amina.yusuf@example.ng', password: 'buyer-demo-2026' },
  seller: { email: 'tunde.okafor@example.ng', password: 'seller-demo-2026' },
  arbitrator: { email: 'n.eze@arbitration.ng', password: 'arbitrator-demo-2026' },
  admin: { email: 'operator@smartguard.ng', password: 'admin-demo-2026' },
};

/**
 * What to capture, in the order a reader should meet it.
 *
 * `evidences` is written into the manifest so each image carries the claim it
 * supports, rather than leaving a reader to guess from the filename.
 */
const SHOTS = [
  {
    role: null, route: '/login', name: '01-login',
    evidences: 'Section 3.15.2 — four roles are four separate sign-ins, not a '
      + 'role selector on one account.',
  },
  {
    role: 'buyer', route: '/escrows', name: '02-buyer-escrows',
    evidences: "FR-02 — the buyer workspace lists only that buyer's escrows.",
  },
  {
    role: 'buyer', route: '/escrows/new', name: '03-buyer-new-escrow',
    evidences: 'Section 3.12.4 and FR-01 — the escrow creation form, whose '
      + 'submission is scored by the FastAPI model before any funds move.',
  },
  {
    // Not /dashboard: that route is a redirect to the role's home, so the shot
    // came back byte-identical to the one above and evidenced nothing. The
    // detail view is what carries the risk score and its contributions.
    role: 'buyer', route: '/escrows/ESC-1042', name: '04-buyer-escrow-detail',
    evidences: 'Section 3.14 and Section 4.3.5 — one escrow in full: the risk '
      + 'score that admitted it, the features that drove that score, and the '
      + 'state the contract currently holds it in.',
    expectRoute: '/escrows/ESC-1042',
  },
  {
    role: 'buyer', route: '/admin', name: '05-rbac-refusal',
    evidences: 'Section 3.15.2 — the decisive shot. A buyer requesting /admin '
      + 'is refused server-side and redirected to /forbidden. The browser '
      + 'cannot assert a role it does not hold, because the session cookie is '
      + 'HttpOnly and signed with a server-held key.',
    expectRoute: '/forbidden',
  },
  {
    role: 'seller', route: '/escrows', name: '06-seller-escrows',
    evidences: 'Section 3.15.2 — the same route renders a different workspace '
      + 'for a different role; permissions are not stacked in one view.',
  },
  {
    role: 'arbitrator', route: '/disputes', name: '07-arbitrator-disputes',
    evidences: "FR-05 and Section 3.11.1 — dispute resolution is reachable "
      + "only by the arbitrator, matching resolveDispute's on-chain check "
      + "against the escrow's recorded arbitrator.",
  },
  {
    role: 'admin', route: '/admin', name: '08-admin-overview',
    evidences: 'Section 3.16 — the operator workspace.',
  },
  {
    role: 'admin', route: '/admin/model', name: '09-admin-model',
    evidences: 'Section 3.14 — the deployed model version and the risk '
      + 'threshold the contract enforces.',
  },
  {
    role: 'admin', route: '/admin/settings', name: '10-admin-settings',
    evidences: 'Section 3.11.3 — the risk threshold is configuration, and the '
      + 'interface says so.',
  },
  {
    role: 'admin', route: '/admin/audit', name: '11-admin-audit',
    evidences: 'Section 3.15.2 — the audit trail, which records the layer and '
      + 'the actor for every recorded event.',
  },
];

async function login(page, role) {
  const account = ACCOUNTS[role];
  await page.goto(`${WEB_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', account.email);
  await page.fill('input[type="password"]', account.password);
  await page.click('button[type="submit"]');
  // The redirect target depends on the role (homeFor in lib/auth/policy.ts),
  // so wait for the URL to stop being /login rather than for a known path.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'),
    { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const captured = [];
  const failures = [];
  const consoleErrors = [];

  const watchConsole = (page) => {
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
  };

  // `next dev` injects a floating dev-tools button that sits over the sidebar.
  // It is part of the toolchain, not of the application, and it has no business
  // appearing in evidence submitted with the report. Hidden at capture time so
  // the application itself is not altered to suit the screenshots.
  const HIDE_DEV_OVERLAY = `
    nextjs-portal,
    [data-nextjs-dev-tools-button],
    [data-nextjs-toast],
    #__next-build-watcher { display: none !important; }
  `;

  try {
    let currentRole = 'none';
    let context = await browser.newContext({
      viewport: VIEWPORT, deviceScaleFactor: SCALE,
    });
    let page = await context.newPage();
    watchConsole(page);
    await page.addStyleTag({ content: HIDE_DEV_OVERLAY }).catch(() => {});

    for (const shot of SHOTS) {
      // A new context per role, so one role's cookie never leaks into another's
      // screenshot — which would make the RBAC evidence worthless.
      if (shot.role !== currentRole) {
        await context.close();
        context = await browser.newContext({
          viewport: VIEWPORT, deviceScaleFactor: SCALE,
        });
        page = await context.newPage();
        watchConsole(page);
        currentRole = shot.role;
        if (shot.role) await login(page, shot.role);
      }

      try {
        await page.goto(`${WEB_URL}${shot.route}`,
          { waitUntil: 'networkidle', timeout: 45000 });
        // Let any client-side data settle before the shutter.
        await page.waitForTimeout(1200);
        // Re-applied per navigation: the dev overlay is re-injected each time.
        await page.addStyleTag({ content: HIDE_DEV_OVERLAY }).catch(() => {});

        const landed = new URL(page.url()).pathname;
        if (shot.expectRoute && !landed.startsWith(shot.expectRoute)) {
          failures.push(
            `${shot.name}: expected to land on ${shot.expectRoute} but reached `
            + `${landed}. The access control this shot evidences did not fire.`,
          );
        }

        const file = path.join(OUT_DIR, `${shot.name}.png`);
        await page.screenshot({ path: file, fullPage: true });

        const bytes = fs.statSync(file).size;
        captured.push({
          name: shot.name,
          file: `docs/evidence/screenshots/${shot.name}.png`,
          role: shot.role ?? 'unauthenticated',
          requestedRoute: shot.route,
          landedRoute: landed,
          evidences: shot.evidences,
          bytes,
        });
        console.log(
          `  ${shot.name.padEnd(24)} ${String(shot.role ?? 'anon').padEnd(12)} `
          + `${shot.route.padEnd(16)} -> ${landed.padEnd(16)} `
          + `${(bytes / 1024).toFixed(0)} KiB`,
        );
      } catch (error) {
        failures.push(`${shot.name}: ${error.message}`);
        console.log(`  ${shot.name.padEnd(24)} FAILED — ${error.message}`);
      }
    }

    const manifest = {
      recordedAt: new Date().toISOString(),
      webUrl: WEB_URL,
      apiUrl: API_URL,
      viewport: { ...VIEWPORT, deviceScaleFactor: SCALE },
      browser: `chrome ${browser.version()}`,
      closes:
        'Appendix A and Table A1 — no interface evidence was retained for any '
        + 'tested scenario.',
      screenshots: captured,
      consoleErrors: [...new Set(consoleErrors)].slice(0, 40),
      failures,
    };
    fs.writeFileSync(
      path.join(OUT_DIR, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    console.log(`\n${captured.length} of ${SHOTS.length} captured`);
    if (consoleErrors.length) {
      console.log(`${new Set(consoleErrors).size} distinct console error(s) recorded`);
    }
    if (failures.length) {
      console.log('\nfailures:');
      for (const f of failures) console.log(`  ${f}`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
