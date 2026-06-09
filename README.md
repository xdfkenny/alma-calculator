# ALMA Calculator

A Chrome extension that provides a soft-cryo dashboard for viewing Alma mastery grades, calculating IB GPA, and comparing performance across school years.

## Features

- **Grade Dashboard** — View all class mastery scores (criteria A–D) at a glance in the browser popup
- **GPA Calculation** — Automatically computes weighted GPA from mastery scores, supporting both IB (/7) and standard (/8) scales
- **Class Exclusion** — Toggle individual classes on/off from your GPA and average calculations
- **School Year Comparison** — Compare grade snapshots across multiple academic years to track progress
- **IB Override** — Manually override IB detection per class when the automatic detection needs adjustment
- **Secure Credential Storage** — Credentials are saved locally via `chrome.storage` and never transmitted to third parties
- **Automatic Login** — Optionally log in to Alma directly from the extension

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the extension directory
5. Pin the extension to your toolbar for quick access

## Usage

1. Click the extension icon to open the popup dashboard
2. Click **Recalculate** to sync grades from Alma
3. Use the toggle switch on each class to include/exclude it from calculations
4. Open the **Options** page to set your Alma credentials and manage class preferences
5. Use the **Years** button to compare grade data across different school years

> **Note:** Set your Alma portal URL in the extension options before logging in.

## Development

This is a vanilla JavaScript Chrome extension with no build step. All source files are plain HTML, CSS, and JS.

```bash
# Load the extension in Chrome via chrome://extensions
# No build tools required
```

To preview the UI without connecting to Alma, the popup and options pages include fallback demo data when `chrome.storage` is unavailable.

## Project Structure

```
├── manifest.json          # Extension manifest (Chrome MV3)
├── background.js          # Service worker — sync, login, and message routing
├── content.js             # Content script — Alma page interaction and grade extraction
├── popup.html / popup.js  # Popup dashboard UI and logic
├── popup.css              # Popup styles
├── options.html / options.js  # Options page for credentials and preferences
├── options.css            # Options page styles
└── assets/icons/          # Extension icons (16, 48, 128 px)
```

## License

[MIT](LICENSE)
