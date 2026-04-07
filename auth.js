// TimeShell - time-box.eu automation
// Login & session management

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const STORAGE_PATH = path.join(__dirname, '.auth-state.json');
const BASE_URL = 'https://time-box.eu';

/**
 * Check if we have a saved session and if it's still valid
 */
async function hasValidSession() {
  if (!fs.existsSync(STORAGE_PATH)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(STORAGE_PATH, 'utf8'));
    // Check if the state has cookies for time-box.eu
    const hasTimeBoxCookies = state.cookies?.some(
      (c) => c.domain?.includes('time-box.eu')
    );
    return hasTimeBoxCookies;
  } catch {
    return false;
  }
}

/**
 * Create a browser context with saved session (if available)
 */
async function createContext(browser) {
  const opts = { viewport: { width: 1280, height: 900 } };
  if (fs.existsSync(STORAGE_PATH)) {
    opts.storageState = STORAGE_PATH;
  }
  return browser.newContext(opts);
}

/**
 * Perform interactive login via Atlassian OAuth.
 * Opens a visible browser for the user to complete login (or for automation with credentials).
 * Saves session state after successful login.
 */
async function login({ email, password, headless = false } = {}) {
  const browser = await chromium.launch({ headless, slowMo: 200 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  console.log('[login] Navigating to TimeBox...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });

  // Click "Log in with Atlassian JIRA"
  console.log('[login] Clicking "Log in with Atlassian JIRA"...');
  await page.click('button:has-text("Log in with Atlassian JIRA")');
  await page.waitForURL('**/id.atlassian.com/**', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Fill email if provided
  if (email) {
    console.log('[login] Filling email...');
    await page.fill('#username-uid1', email);
    await page.click('#login-submit');
    await page.waitForTimeout(3000);

    // After email, Atlassian may show password field or redirect to SSO
    const passwordField = await page.$('#password');
    if (passwordField && password) {
      console.log('[login] Filling password...');
      await passwordField.fill(password);
      await page.click('#login-submit');
    }
  }

  // Wait for redirect back to time-box.eu after successful login
  console.log('[login] Waiting for login to complete (complete manually if needed)...');
  try {
    await page.waitForURL(`${BASE_URL}/**`, { timeout: 300000 }); // 5 min for manual login
  } catch {
    console.error('[login] Timeout waiting for redirect to time-box.eu');
    await browser.close();
    return null;
  }

  // Verify we're logged in by checking if /api/users/me returns 200
  console.log('[login] Verifying session...');
  await page.waitForTimeout(3000);
  const currentUrl = page.url();
  console.log('[login] Current URL:', currentUrl);

  if (currentUrl.includes('/login')) {
    console.error('[login] Still on login page - login may have failed');
    await browser.close();
    return null;
  }

  // Save session state
  console.log('[login] Saving session...');
  await context.storageState({ path: STORAGE_PATH });
  console.log('[login] Session saved to', STORAGE_PATH);

  return { browser, context, page };
}

/**
 * Get an authenticated page. Tries saved session first, falls back to login.
 */
async function getAuthenticatedPage({ headless = false, email, password } = {}) {
  // Try with saved session first
  if (await hasValidSession()) {
    console.log('[auth] Found saved session, verifying...');
    const browser = await chromium.launch({ headless, slowMo: 100 });
    const context = await createContext(browser);
    const page = await context.newPage();

    // Test if session is still valid
    const response = await page.goto(`${BASE_URL}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const url = page.url();

    if (!url.includes('/login')) {
      console.log('[auth] Saved session is valid');
      return { browser, context, page };
    }

    console.log('[auth] Saved session expired, re-logging in...');
    await browser.close();
  }

  // Login fresh
  return login({ email, password, headless });
}

module.exports = { login, getAuthenticatedPage, hasValidSession, STORAGE_PATH, BASE_URL };

// If run directly, perform interactive login
if (require.main === module) {
  const email = process.env.TIMEBOX_EMAIL || null;
  const password = process.env.TIMEBOX_PASSWORD || null;

  (async () => {
    const result = await login({ email, password, headless: false });
    if (result) {
      console.log('\n[login] Login successful! Session saved.');
      console.log('[login] You can now run the automation scripts.');
      await result.browser.close();
    } else {
      console.error('\n[login] Login failed.');
      process.exit(1);
    }
  })();
}
