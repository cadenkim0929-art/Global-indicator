const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const outDir = path.join(process.cwd(), 'qa');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const [name, viewport] of Object.entries({ mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 1000 } })) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
    await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: false, timeout: 15000 });
    const title = await page.locator('h1').innerText();
    // Feed page: search
    await page.getByPlaceholder('Search...').fill('Covestro');
    const visibleAfterSearch = await page.locator('.newsCard').count();
    // Switch to Sources
    await page.getByRole('button', { name: 'Sources' }).click();
    const visibleSources = await page.locator('.sourceRow').count();
    results.push({ name, title, visibleAfterSearch, visibleSources, errors });
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(outDir, 'playwright-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
})();
