// TimeShell - time-box.eu browser automation
// Core booking and status operations (template-based)

const { getAuthenticatedPage, STORAGE_PATH } = require('./auth');

const BASE_URL = 'https://time-box.eu';

// Hours category code -> display name
const CATEGORIES = {
  BG:     'Hours in BG',
  PT:     'Hours of Strypes Portugal',
  FO_NL:  'Hours of Front Office NL',
  FO_USA: 'Hours of Front office US',
  AD:     'Account Delivery',
  FD:     'Hours of Functional Dev',
  SD:     'Hours of Software Dev',
  SM:     'Hours of Scrum Master',
  PO:     'Hours of Product Owner',
  PM:     'Hours of Project Mgmt',
};

const DAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// ─── Date helpers ────────────────────────────────────────────────────

/** DD/MM/YYYY */
function fmtUI(d) {
  const dt = new Date(d);
  return [
    String(dt.getDate()).padStart(2, '0'),
    String(dt.getMonth() + 1).padStart(2, '0'),
    dt.getFullYear(),
  ].join('/');
}

/** YYYY-MM-DD */
function fmtAPI(d) {
  const dt = new Date(d);
  return [
    dt.getFullYear(),
    String(dt.getMonth() + 1).padStart(2, '0'),
    String(dt.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Get the Monday of ISO week `wk` in `year`.
 * ISO weeks: week 1 contains the first Thursday of the year.
 */
function weekToMonday(year, wk) {
  // Jan 4 is always in ISO week 1
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7; // 1=Mon … 7=Sun
  const mondayWk1 = new Date(jan4);
  mondayWk1.setDate(jan4.getDate() - dayOfWeek + 1);
  const target = new Date(mondayWk1);
  target.setDate(mondayWk1.getDate() + (wk - 1) * 7);
  return target;
}

/** Array of 7 Date objects (Mon–Sun) for the given ISO week. */
function weekDates(year, wk) {
  const mon = weekToMonday(year, wk);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d;
  });
}

// ─── Template processing ─────────────────────────────────────────────

/**
 * Expand a template into a flat list of booking actions.
 *
 * Each action = one dialog submission:
 *   { jiraId, category, hours, startDate, endDate, comment, overtime }
 *
 * Because "Time Spent per day" is a single number applied to every day in the
 * range, we group consecutive days with the **same** hours into one range.
 */
function expandTemplate(template, year, wk) {
  const dates = weekDates(year, wk);          // [Mon, Tue, … Sun]
  const actions = [];

  for (const entry of template.entries) {
    // Build per-day hours array  [mon, tue, wed, thu, fri, sat, sun]
    const daily = DAY_NAMES.map((name) => entry.days[name] || 0);

    // Group consecutive days with the same non-zero hours
    let i = 0;
    while (i < 7) {
      const h = daily[i];
      if (h === 0) { i++; continue; }
      let j = i + 1;
      while (j < 7 && daily[j] === h) j++;
      // days[i..j-1] all have `h` hours
      actions.push({
        jiraId:    entry.jiraId,
        category:  entry.category,
        hours:     h,
        startDate: dates[i],
        endDate:   dates[j - 1],
        comment:   entry.comment || '',
        overtime:  entry.overtime || false,
      });
      i = j;
    }
  }

  return actions;
}

// ─── Booking ─────────────────────────────────────────────────────────

/**
 * Book a single time entry via the UI dialog.
 * Assumes `page` is already on the dashboard.
 * Returns { success, error? }
 */
async function bookSingle(page, action) {
  const dateRange = `${fmtUI(action.startDate)} - ${fmtUI(action.endDate)}`;
  const label = `${action.jiraId} | ${action.hours}h | ${dateRange}`;
  console.log(`  [book] ${label}`);

  // Open dialog
  await page.click('text=Book time with story Jira ID');
  await page.waitForSelector('.chakra-modal__content', { timeout: 5000 });
  await page.waitForTimeout(400);

  // Fill fields
  await page.fill('input[name="jira_id"]', action.jiraId);
  await page.selectOption('select[name="category"]', action.category);

  // === Date range via react-datepicker calendar clicks ===
  await selectDateRange(page, action.startDate, action.endDate);

  await page.fill('input[name="time_logged"]', String(action.hours));

  if (action.comment) {
    await page.fill('input[name="comment"]', action.comment);
  }
  if (action.overtime) {
    await page.check('input[name="overtime"]');
  }

  await page.waitForTimeout(300);
  return { success: true };
}

/**
 * Select a date range using the react-datepicker calendar UI.
 * Clicks the start date, then the end date.
 */
async function selectDateRange(page, startDate, endDate) {
  const dateInput = page.locator('input[name="dates"]');

  // Open calendar
  await dateInput.click();
  await page.waitForTimeout(300);

  const startLabel = ariaDateLabel(startDate);
  const isSingleDay = fmtAPI(startDate) === fmtAPI(endDate);

  // Navigate to the month of the start date
  await navigateCalendarToMonth(page, startDate);

  // Click start date
  await page.click(`.react-datepicker__day[aria-label="${startLabel}"]`);
  await page.waitForTimeout(300);

  if (!isSingleDay) {
    // If end date is in a different month, navigate forward
    const startMonth = new Date(startDate).getMonth();
    const endMonth = new Date(endDate).getMonth();
    if (endMonth !== startMonth) {
      await navigateCalendarToMonth(page, endDate);
    }

    const endLabel = ariaDateLabel(endDate);
    await page.click(`.react-datepicker__day[aria-label="${endLabel}"]`);
    await page.waitForTimeout(300);
  }

  // Dismiss calendar by clicking another field (not Escape - that closes the modal)
  await page.click('input[name="jira_id"]');
  await page.waitForTimeout(300);
}

/**
 * Build the aria-label string for a date, matching react-datepicker format.
 * e.g. "Choose Monday, 30 March 2026"
 */
function ariaDateLabel(date) {
  const d = new Date(date);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
  return `Choose ${dayNames[d.getDay()]}, ${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Navigate the react-datepicker to show the month of `targetDate`.
 * Reads the current month header and clicks prev/next as needed.
 */
async function navigateCalendarToMonth(page, targetDate) {
  const target = new Date(targetDate);
  const targetMonth = target.getMonth(); // 0-indexed
  const targetYear = target.getFullYear();

  for (let attempt = 0; attempt < 24; attempt++) {
    // Read the current month/year from the calendar header
    const headerText = await page.textContent('.react-datepicker__current-month');
    // e.g. "March 2026" or locale-dependent
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                         'July', 'August', 'September', 'October', 'November', 'December'];

    let currentMonth = -1;
    let currentYear = -1;
    for (let m = 0; m < 12; m++) {
      if (headerText.includes(monthNames[m])) {
        currentMonth = m;
        break;
      }
    }
    const yearMatch = headerText.match(/\d{4}/);
    if (yearMatch) currentYear = parseInt(yearMatch[0], 10);

    if (currentMonth === targetMonth && currentYear === targetYear) return;

    // Calculate direction
    const currentTotal = currentYear * 12 + currentMonth;
    const targetTotal = targetYear * 12 + targetMonth;

    if (targetTotal > currentTotal) {
      await page.click('.react-datepicker__navigation--next');
    } else {
      await page.click('.react-datepicker__navigation--previous');
    }
    await page.waitForTimeout(200);
  }
}

/**
 * Submit the currently open dialog by clicking OK.
 * Waits for the modal to close or captures errors.
 */
async function submitDialog(page) {
  // Capture the API response
  const responsePromise = new Promise((resolve) => {
    const handler = async (res) => {
      if (res.url().includes('/api/') && res.request().method() !== 'GET') {
        page.off('response', handler);
        let body;
        try { body = await res.json(); } catch {}
        resolve({ status: res.status(), body });
      }
    };
    page.on('response', handler);
    // Timeout fallback
    setTimeout(() => resolve(null), 10000);
  });

  await page.click('button:has-text("OK")');
  const apiRes = await responsePromise;
  await page.waitForTimeout(1500);

  // Check if modal is still visible (indicates error)
  const modal = await page.$('.chakra-modal__content');
  if (modal) {
    const text = await modal.innerText();
    if (text.toLowerCase().includes('error') || text.toLowerCase().includes('invalid') || text.toLowerCase().includes('fail')) {
      // Close modal
      const cancelBtn = await page.$('button:has-text("Cancel")');
      if (cancelBtn) await cancelBtn.click();
      await page.waitForTimeout(500);
      return { success: false, error: text.trim(), apiRes };
    }
    // Modal might still be closing
    await page.waitForTimeout(1000);
  }

  return { success: true, apiRes };
}

/**
 * Book all entries from a template for a given week.
 *
 * @param {Object}  template        - Parsed template JSON
 * @param {number}  year            - e.g. 2026
 * @param {number}  wk              - ISO week number
 * @param {Object}  [opts]
 * @param {boolean} [opts.headless] - default true
 * @param {boolean} [opts.dryRun]   - fill forms but don't submit
 */
async function bookWeek(template, year, wk, opts = {}) {
  const { headless = true, dryRun = false } = opts;
  const actions = expandTemplate(template, year, wk);

  if (actions.length === 0) {
    console.log('No bookings to make (template has no hours for this week pattern).');
    return [];
  }

  // Summary
  const totalHours = actions.reduce((sum, a) => {
    const days = Math.round((a.endDate - a.startDate) / 86400000) + 1;
    return sum + a.hours * days;
  }, 0);

  console.log(`\n=== Booking week ${wk} (${year}) ===`);
  console.log(`Template: ${template.name || 'unnamed'}`);
  console.log(`Actions:  ${actions.length} bookings`);
  console.log(`Total:    ${totalHours}h`);
  if (dryRun) console.log('MODE:     DRY RUN (will fill forms but NOT submit)');
  console.log('');

  // Preview
  for (const a of actions) {
    const days = Math.round((a.endDate - a.startDate) / 86400000) + 1;
    console.log(`  ${a.jiraId.padEnd(12)} ${String(a.hours).padStart(4)}h x ${days}d  ${fmtUI(a.startDate)}-${fmtUI(a.endDate)}  [${a.category}]  ${a.comment}`);
  }
  console.log('');

  // Launch browser
  const result = await getAuthenticatedPage({ headless });
  if (!result) throw new Error('Authentication failed. Run: node auth.js');
  const { browser, context, page } = result;

  const results = [];

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      console.log(`\n[${i + 1}/${actions.length}]`);

      const fillResult = await bookSingle(page, action);
      if (!fillResult.success) {
        results.push({ ...action, success: false, error: fillResult.error });
        continue;
      }

      if (dryRun) {
        await page.screenshot({ path: `screenshot-dry-${i + 1}.png`, fullPage: true });
        console.log(`  [dry] Screenshot: screenshot-dry-${i + 1}.png`);
        // Close the dialog without submitting
        await page.click('button:has-text("Cancel")');
        await page.waitForTimeout(500);
        results.push({ ...action, success: true, dryRun: true });
      } else {
        const submitResult = await submitDialog(page);
        if (submitResult.success) {
          console.log('  [ok] Booked successfully');
        } else {
          console.error(`  [FAIL] ${submitResult.error}`);
        }
        results.push({ ...action, ...submitResult });
        // Wait for timetable to refresh
        await page.waitForTimeout(1500);
      }
    }

    // Final screenshot
    await page.screenshot({ path: 'screenshot-final.png', fullPage: true });
    console.log('\nFinal state screenshot: screenshot-final.png');

    // Print summary
    const ok = results.filter((r) => r.success).length;
    const fail = results.filter((r) => !r.success).length;
    console.log(`\n=== Done: ${ok} succeeded, ${fail} failed ===`);

  } finally {
    await context.storageState({ path: STORAGE_PATH });
    await browser.close();
  }

  return results;
}

// ─── Status ──────────────────────────────────────────────────────────

/**
 * Print the current week's timetable.
 */
async function getStatus(opts = {}) {
  const { year, wk, headless = true } = opts;

  const result = await getAuthenticatedPage({ headless });
  if (!result) throw new Error('Authentication failed. Run: node auth.js');
  const { browser, context, page } = result;

  try {
    // Determine target date
    let targetDate;
    if (year && wk) {
      targetDate = fmtAPI(weekToMonday(year, wk));
    } else {
      targetDate = fmtAPI(new Date());
    }

    // Fetch timetable via page context (uses session cookies)
    const data = await page.evaluate(async (d) => {
      const resp = await fetch(`/api/timetable/date/${d}/period/weekly/impersonate/`);
      return resp.json();
    }, targetDate);

    if (!data?.weeks?.[0]) throw new Error('No timetable data');

    const week = data.weeks[0];
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    console.log(`\n=== TimeBox - Week of ${week.week_dates[0]} to ${week.week_dates[6]} ===\n`);

    // Bookings table
    if (Object.keys(week.bookings).length > 0) {
      const colW = 6;
      const keyW = 14;
      const sumW = 10;

      // Header
      const hdr = 'Key'.padEnd(keyW) + 'Summary'.padEnd(sumW) + dayLabels.map((d) => d.padStart(colW)).join('') + '  Total';
      console.log(hdr);
      console.log('─'.repeat(hdr.length));

      for (const [key, booking] of Object.entries(week.bookings)) {
        const summary = (booking.summary || '').substring(0, sumW - 2);
        const dailyStr = (booking.daily_hours || [0,0,0,0,0,0,0]).map((h) => String(h || '-').padStart(colW)).join('');
        const total = (booking.daily_hours || []).reduce((s, h) => s + (h || 0), 0);
        console.log(`${key.padEnd(keyW)}${summary.padEnd(sumW)}${dailyStr}  ${total.toFixed(1)}`);
      }
      console.log('─'.repeat(hdr.length));
    } else {
      console.log('No bookings.');
    }

    // Totals
    console.log('');
    const dailyTotals = week.total_daily_hours.map((h) => h.toFixed(1).padStart(6)).join('');
    console.log(`${'Daily totals'.padEnd(24)}${dailyTotals}`);
    console.log(`\nWeekly: ${week.total_weekly_hours} / ${week.expected_hours}h`);
    if (week.total_overtime_hours) console.log(`Overtime: ${week.total_overtime_hours}h`);
    if (Object.keys(week.time_off).length > 0) console.log(`Time off: ${JSON.stringify(week.time_off)}`);

    return data;
  } finally {
    await context.storageState({ path: STORAGE_PATH });
    await browser.close();
  }
}

module.exports = {
  CATEGORIES,
  DAY_NAMES,
  bookWeek,
  bookSingle,
  submitDialog,
  getStatus,
  expandTemplate,
  weekToMonday,
  weekDates,
  fmtUI,
  fmtAPI,
};
