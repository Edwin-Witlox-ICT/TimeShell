# TimeShell

Browser automation for [time-box.eu](https://time-box.eu) weekly time tracking. Uses Playwright to drive a Chromium browser through the booking UI, filling in hours from JSON templates.

Built for Strypes EOOD's internal timeboxing app that integrates with Atlassian Jira.

## Prerequisites

- Node.js 18+
- A time-box.eu account with Atlassian Jira OAuth access
- 1Password (or manual credentials) for Atlassian login

## Install

```
npm install
```

This installs Playwright and its bundled Chromium browser.

## Quick start

```bash
# 1. Log in (opens a browser window -- complete login via 1Password)
node timeshell.js login

# 2. Check your current timetable
node timeshell.js status

# 3. Create a template
node timeshell.js init-template myweek
# Edit templates/myweek.json with your Jira IDs, categories, and hours

# 4. Dry run (fills forms but doesn't submit)
node timeshell.js book --week 14 --template myweek --dry --headed

# 5. Book for real
node timeshell.js book --week 14 --template myweek
```

## Commands

| Command | Description |
|---|---|
| `login` | Interactive Atlassian OAuth login. Session saved to `.auth-state.json`. |
| `status [--week N] [--year Y]` | Print timetable for a given ISO week. |
| `book --week N --template FILE [--dry] [--headed]` | Book hours from a template. |
| `editor [--port N]` | Open the web-based template editor (default port 4000). |
| `templates` | List available templates. |
| `categories` | Print valid hour category codes. |
| `init-template <name>` | Scaffold a new template file. |
| `help` | Show usage information. |

### Options

| Flag | Description |
|---|---|
| `--week, -w N` | ISO week number (default: current week) |
| `--year, -y Y` | Year (default: current year) |
| `--template, -t FILE` | Template name or path |
| `--dry, --dry-run` | Fill forms but don't submit |
| `--headed, --visible` | Show the browser window |
| `--port N` | Port for the template editor (default: 4000) |

## Templates

Templates are JSON files in the `templates/` directory. Each defines a set of Jira entries with per-day hours.

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

**Day keys**: `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun` -- omit or set to `0` to skip.

The engine groups consecutive days with the same hours into a single booking to minimize dialog submissions.

## Template editor

A built-in web UI for visually editing templates. No external dependencies -- runs on Node's built-in `http` module.

```bash
node timeshell.js editor              # http://localhost:4000
node timeshell.js editor --port 4000  # custom port
```

Features:

- Spreadsheet-style grid with one row per Jira entry and columns for each day
- Hour inputs step in 0.25h (15-minute) increments
- Per-row totals, per-day column totals, and weekly total with color coding
- **Spread button** (`=`) on each row -- distributes the row's total hours evenly across Mon-Fri
- **Weekend toggle** -- show or hide Sat/Sun columns (hidden by default)
- Create new templates, switch between existing ones
- Ctrl+S to save, with a fixed-position toast confirmation
- Unsaved-changes warning on page close

## Category codes

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

## How it works

1. **Authentication**: Atlassian OAuth login through a real browser. The user completes login manually (1Password auto-fill). Session cookies are persisted to `.auth-state.json` and reused on subsequent runs.

2. **Template expansion**: Per-day hours are grouped into consecutive-day ranges. For example, Mon-Fri at 8h becomes one booking action instead of five.

3. **Form automation**: For each booking action, the tool opens the Chakra UI dialog, fills the Jira ID, selects the category, picks dates via the react-datepicker calendar (clicking day elements by `aria-label`), enters hours, and submits.

4. **Dry run**: With `--dry`, forms are filled and screenshotted but not submitted. Always do a dry run before booking a new template.

## Project structure

```
timeshell.js         CLI entry point
timebox.js           Core booking engine
auth.js              Login & session management
editor.js            Web-based template editor (HTTP server + embedded frontend)
templates/           Booking templates (JSON)
.auth-state.json     Saved session (gitignored)
```

## License

ISC
