---
name: timebox
description: Automate time-box.eu weekly hour bookings via Playwright browser automation with template-based entries, calendar interaction, and Atlassian OAuth session management
---

## What I do

Automate weekly time tracking on [time-box.eu](https://time-box.eu) (a Strypes EOOD internal timeboxing app that integrates with Atlassian Jira). The tool uses Playwright to drive a headed or headless Chromium browser, filling in the booking dialog for each Jira story/category/day combination defined in a JSON template.

## Project layout

```
C:\DEVELOP\TimeShell\
  auth.js              # Login & session management (Atlassian OAuth via browser)
  timebox.js           # Core booking engine (template expansion, calendar, form filling)
  timeshell.js         # CLI entry point
  package.json         # Node.js project (dependency: playwright)
  .auth-state.json     # Saved Playwright storageState (gitignored)
  templates/           # JSON booking templates
    myweek.json        # Example multi-entry template
```

## CLI commands

All commands are run with `node timeshell.js <command>`.

| Command | Description |
|---|---|
| `login` | Open a headed browser for Atlassian OAuth login. Session is saved to `.auth-state.json`. User completes login manually via 1Password. |
| `status [--week N] [--year Y]` | Fetch and print the timetable for a given ISO week. |
| `book --week N --template FILE [--dry] [--headed]` | Book hours from a template. `--dry` fills forms but does not submit. `--headed` shows the browser. |
| `templates` | List all templates in `templates/`. |
| `categories` | Print valid hour category codes. |
| `init-template <name>` | Scaffold a new template JSON file. |

## Template format

Templates live in `templates/*.json`. Each template has a `name`, optional `description`, and an `entries` array. Each entry specifies a Jira ID, category code, optional comment, and per-day hours.

```json
{
  "name": "myweek",
  "description": "Standard work week",
  "entries": [
    {
      "jiraId": "PROJ-123",
      "category": "SD",
      "comment": "Development work",
      "days": { "mon": 8, "tue": 8, "wed": 8, "thu": 8, "fri": 8 }
    },
    {
      "jiraId": "PROJ-456",
      "category": "SM",
      "comment": "Scrum ceremonies",
      "days": { "wed": 2, "fri": 2 }
    }
  ]
}
```

### Day keys

`mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun` -- omit a day or set to `0` to skip it.

### Category codes

| Code | Description |
|---|---|
| `BG` | Hours in BG |
| `PT` | Hours of Strypes Portugal |
| `FO_NL` | Hours of Front Office NL |
| `FO_USA` | Hours of Front Office US |
| `AD` | Account Delivery |
| `FD` | Hours of Functional Dev |
| `SD` | Hours of Software Dev |
| `SM` | Hours of Scrum Master |
| `PO` | Hours of Product Owner |
| `PM` | Hours of Project Mgmt |

## How booking works

1. **Template expansion** (`expandTemplate`): Each entry's per-day hours are grouped into consecutive-day ranges sharing the same hour value. This minimizes the number of dialog submissions (e.g., Mon-Fri at 8h becomes one booking instead of five).

2. **Browser launch**: A Playwright Chromium browser loads the saved session from `.auth-state.json`. If the session is expired, the user is prompted to re-login.

3. **For each booking action**:
   - Click "Book time with story Jira ID" to open the Chakra UI modal dialog.
   - Fill `input[name="jira_id"]` with the Jira story ID.
   - Select `select[name="category"]` with the category code.
   - **Date selection via react-datepicker**: Click `input[name="dates"]` to open the calendar. Navigate to the correct month using `.react-datepicker__navigation--previous` / `--next`. Click the target day element by its `aria-label` (e.g., `"Choose Monday, 30 March 2026"`). For multi-day ranges, click start date then end date. For single-day entries, click only once.
   - Dismiss the calendar by clicking `input[name="jira_id"]` (NOT Escape, which closes the Chakra modal).
   - Fill `input[name="time_logged"]` with the hours value.
   - Optionally fill `input[name="comment"]` and check `input[name="overtime"]`.
   - In dry-run mode: take a screenshot and click Cancel.
   - In live mode: click "OK", wait for the API response, verify success.

4. **Session persistence**: After each run, the browser storage state is saved back to `.auth-state.json`.

## Critical implementation notes

These are hard-won lessons. Do NOT deviate from them:

- **Date input**: NEVER use `page.fill()` on the date input. The react-datepicker does not register values set via `fill()`. Always click calendar day elements by their `aria-label`.
- **Calendar dismissal**: After selecting dates, click `input[name="jira_id"]` to dismiss the calendar. Do NOT press Escape -- that closes the entire Chakra modal dialog.
- **Single-day bookings**: When start date equals end date, click the date only once. Do not attempt to click an "end date".
- **Cross-month navigation**: If the start and end dates span different months, navigate the calendar forward after clicking the start date.
- **aria-label format**: `"Choose {DayName}, {DayNumber} {MonthName} {Year}"` -- e.g., `"Choose Monday, 30 March 2026"`. English locale only.
- **Login flow**: Atlassian OAuth login requires a headed browser. The user logs in manually using 1Password. The automation waits up to 5 minutes for the redirect back to time-box.eu.

## When to use me

Use this skill when:

- The user asks to book, log, or fill in hours/time on time-box.eu
- The user wants to create, edit, or validate a booking template
- The user asks about the status of their timetable for a given week
- The user wants to modify the booking engine behavior (calendar interaction, form filling, template expansion)
- The user mentions TimeShell, timebox, or time tracking automation

## Typical workflows

### First-time setup
```
node timeshell.js login          # Interactive browser login
node timeshell.js status         # Verify session works
node timeshell.js init-template myweek
# Edit templates/myweek.json with real Jira IDs
```

### Weekly booking
```
node timeshell.js book --week 14 --template myweek --dry --headed   # Dry run first
node timeshell.js book --week 14 --template myweek                  # Actual booking
node timeshell.js status --week 14                                  # Verify
```

## API endpoints (for reference)

These are internal time-box.eu endpoints, accessible only with valid session cookies:

| Endpoint | Method | Description |
|---|---|---|
| `/api/users/me` | GET | Current user profile |
| `/api/users/me/preferences` | GET | User preferences/favourites |
| `/api/timetable/date/{YYYY-MM-DD}/period/weekly/impersonate/` | GET | Weekly timetable data |
| `/api/boards` | GET | Available Jira boards |

## Environment details

- **Site**: https://time-box.eu (React SPA, Chakra UI)
- **Auth**: Atlassian JIRA OAuth via https://id.atlassian.com
- **Jira base URL**: https://ictgroupeu.atlassian.net
- **User location**: NL, 40h/week expected
- **Runtime**: Node.js with Playwright (Chromium)
- **Platform**: Windows (PowerShell)
