# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

A PWA (Progressive Web App) teacher attendance system with Google Sign-In, GPS geofencing, and optional face recognition. No build step — plain HTML/CSS/JS served statically. The backend is Google Apps Script deployed as a Web App, with Google Sheets as the database.

## Running Locally

Serve with any static file server. VS Code Live Server is the standard approach:
- Open with Live Server → runs at `http://127.0.0.1:5500`
- Add `http://127.0.0.1:5500` to **Authorized JavaScript origins** in Google Cloud Console OAuth credentials

No build, no npm, no compilation.

## Configuration — Always Edit `js/config.js` First

All environment-specific values live here:
- `SCRIPT_URL` — Google Apps Script Web App URL (after deploy)
- `GOOGLE_CLIENT_ID` — from Google Cloud Console (OAuth 2.0, type: Web application)
- `SCHOOL_LAT` / `SCHOOL_LNG` / `GPS_RADIUS_METERS` — school geofence
- `ENABLE_GPS_CHECK: false` — set false during local dev (PC has no reliable GPS)
- `ENABLE_FACE_CHECK: false` — set false to skip face scan; models must be in `models/` to enable
- `ADMIN_EMAILS` in `google-apps-script/Code.gs` must also be updated to match real admin emails

## Architecture

### Frontend (`js/`)

Scripts load in this order via `<script>` tags in `index.html`: `config.js` → `auth.js` → `gps.js` → `face.js` → `api.js` → `app.js`. Each is an IIFE module exposing a single global object.

**Screen flow** (managed by `App` in `app.js`):
```
loading → login → (GPS check) → action screen → success
                                              ↘ admin dashboard
```

- `app.js` — orchestrates all screens and user flows. All cross-module coordination happens here.
- `auth.js` — Google Identity Services (GSI). Loads GSI dynamically via `_loadGSI()` so `client_id` can be injected before the library reads the DOM. Callback is `window.handleGoogleSignIn`.
- `api.js` — all `fetch` calls to the Apps Script URL. Uses no `Content-Type` header (avoids CORS preflight on GAS).
- `gps.js` — Haversine formula geofence check. Returns `{ ok, distance, position }`.
- `face.js` — face-api.js wrapper. Only loaded/used when `ENABLE_FACE_CHECK` is true.

**Action screen** (`screen-action`) always resets button `disabled` state at the top of `_showActionScreen()` before checking status — required because buttons persist across renders.

### Backend (`google-apps-script/Code.gs`)

Copy-paste into Google Apps Script editor, deploy as Web App (Execute as: Me, Who has access: Anyone).

**Key patterns:**
- All functions use `_ensureHeaders()` before reading/writing — detects schema mismatch, backs up old sheet to a timestamped copy, and rewrites headers
- `_normalizeDateCell()` and `_normalizeTimeCell()` — Google Sheets auto-converts date/time strings to Date objects; always use these when reading cells
- `_appendRow()` sets `@` (text) number format on date/time columns after writing to prevent future auto-conversion
- `_findTodayRecord()` returns `rowIndex` (1-based) for direct cell updates in `checkOut`
- `resetAttendance()` / `resetAll()` — run from Apps Script editor to wipe sheets during dev/testing

**Attendance sheet schema** (order matters for `_appendRow`):
`date, checkInTime, checkOutTime, email, name, subject, status, checkInMethod, checkOutMethod, workHours, lat, lng`

**After any change to `Code.gs`:** go to Deploy → Manage deployments → edit → bump version → Deploy. The URL stays the same.

## Known Gotchas

- **Google Sheets time auto-conversion**: storing `"08:30"` gets converted to a Date object with epoch `Dec 30 1899`. Always read through `_normalizeTimeCell()`.
- **GSI `auto_select`**: initialized with `auto_select: false` — without this, Google re-logs the user in immediately after signout.
- **JWT parsing**: Google's credential JWT uses URL-safe base64 (`-`, `_`). `atob()` requires standard base64 — replace before decoding (done in `auth.js` `_parseJwt`).
- **CORS preflight**: sending `Content-Type: application/json` to Apps Script triggers a preflight that GAS rejects. `api.js` omits the header intentionally.
- **Schema migration**: if the Attendance sheet was created with old headers, run `resetAttendance()` in the Apps Script editor to rebuild with correct schema.
