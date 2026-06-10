# ALMA Calculator

A Chrome extension that turns Alma mastery grades into a compact student dashboard for GPA, averages, semesters, criteria, and class priorities.

## Features

- **Grade Dashboard** - View class mastery scores for criteria A-D from the browser popup
- **GPA Calculation** - Computes GPA from mastery scores, supporting both IB (/7) and standard (/8) scales
- **Focus Panel** - Shows the next useful action, GPA target progress, priority classes, and classes below target
- **Semester Summaries** - Calculates first-semester and second-semester GPA and average when Alma period labels are available
- **Criteria Summary** - Averages criteria A-D across included classes and highlights the weakest criterion
- **Watch List** - Marks classes that fall below a configurable average or have a weak criterion score
- **Academic Goals** - Lets students set a target GPA and watch average from the Options page
- **Class Exclusion** - Toggle individual classes on/off from GPA and average calculations
- **School Year Comparison** - Compare grade snapshots across multiple academic years
- **IB Override** - Manually override IB detection per class when automatic detection needs adjustment
- **Secure Credential Storage** - Credentials are saved locally via `chrome.storage` and never transmitted to third parties
- **Automatic Login** - Optionally log in to Alma directly from the extension

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** in the top right
4. Click **Load unpacked** and select the extension directory
5. Pin the extension to your toolbar for quick access

## Usage

1. Click the extension icon to open the popup dashboard
2. Click **Recalculate** to sync grades from Alma
3. Review **Focus**, **Semesters**, and **Criteria** for priority study signals
4. Use the toggle switch on each class to include or exclude it from calculations
5. Open **Options** to set your Alma portal, credentials, target GPA, watch average, and class preferences
6. Use **Years** to compare grade data across different school years

> Note: Set your Alma portal URL in the extension options before logging in.

## Development

This is a vanilla JavaScript Chrome extension with no build step. All source files are plain HTML, CSS, and JS.

```bash
# Load the extension in Chrome via chrome://extensions
# No build tools required
```

To preview the UI without connecting to Alma, the popup and options pages include fallback demo data when `chrome.storage` is unavailable.

## Project Structure

```text
manifest.json              # Extension manifest (Chrome MV3)
background.js              # Service worker: sync, login, message routing, and calculations
content.js                 # Content script: Alma page interaction and grade extraction
popup.html / popup.js      # Popup dashboard UI and logic
popup.css                  # Popup styles
options.html / options.js  # Options page for credentials, goals, and preferences
options.css                # Options page styles
assets/icons/              # Extension icons (16, 48, 128 px)
```

## License

[MIT](LICENSE)
