# Field Instruments — Webpage Annotation Overlay

**Version 1.1.3**

A self-contained Tampermonkey userscript for placing persistent highlights, margin notes, arrows, and labels over almost any webpage without modifying the source site.

The annotator turns live webpages into review surfaces that can be organized into multi-page collections, preserved with sanitized evidence snapshots, and exported into workflows for **Trace**, **Critique**, design reports, training documentation, and **Reliquary**.

## Purpose

Webpage Annotation Overlay is intended for browser-based work that must eventually become evidence, review findings, documentation, or a durable project record.

Common uses include:

- Capturing quotations and evidence for **Trace**
- Recording usability, accessibility, quality, or compliance findings
- Preparing structured reviews for **Critique**
- Creating annotated design-report appendices
- Building browser-based training and reference documentation
- Preserving web artifacts in **Reliquary**
- Reviewing dashboards, requirements, procedures, interfaces, and technical references

## Features

### Annotation tools

#### Highlight

Select text on the webpage and preserve it as quoted evidence. Highlights are drawn as overlays and do not wrap or rewrite the website's text nodes.

#### Margin Note

Attach a detailed note to a point on the page. Notes appear at the page margin with a leader line back to the selected anchor.

#### Arrow

Drag from one point to another to create a directional callout. Arrows can include a visible label and supporting observation.

#### Label

Place a compact visible label at a selected webpage location.

### Annotation metadata

Each annotation can include:

- Title
- Observation or supporting note
- Visible label where applicable
- Category
- Severity
- Color
- Tags
- Quoted text where applicable
- Source URL and page title
- Creation and modification timestamps
- Saved anchor and locator information

Categories include:

- Evidence
- Issue
- Recommendation
- Training
- Reference
- Decision
- Question

Severity levels include:

- Info
- Low
- Medium
- High
- Critical

### Local persistence

Annotations are stored through Tampermonkey in the local browser profile. Each page record is associated with its normalized URL, including its origin, path, and query string.

The source webpage is not edited, uploaded, or rewritten.

The script also watches for URL changes used by single-page applications and loads the appropriate annotation record when navigation occurs.

### Collapsed startup

The annotator starts collapsed. Only the small **A** launcher appears until the panel is opened.

Open or collapse the panel by:

- Clicking the **A** launcher
- Pressing `Alt + Shift + A`
- Choosing **Toggle Web Annotator** from the Tampermonkey menu

### Multi-page collections

Related webpages can be grouped into collections representing a review, investigation, evidence package, training package, or project record.

Collection tools support:

- Creating and describing a collection
- Assigning the current page to a collection
- Switching the active collection
- Reviewing page, annotation, and snapshot totals
- Opening indexed source pages
- Exporting the current page or the entire active collection
- Deleting a collection while returning its pages to the built-in **Inbox**

The **Inbox** collection cannot be deleted.

### Evidence snapshots

A snapshot captures a sanitized structural copy of the current webpage together with source metadata and a content hash.

The snapshot process removes or neutralizes:

- Scripts and `noscript` content
- Frames, embedded objects, and portals
- Automatic refresh directives
- Content-security-policy metadata
- Inline event handlers
- Nonce attributes
- Live form values

Snapshot metadata includes:

- Capture date and time
- Source URL and page title
- Page language and description
- Viewport dimensions
- Scroll position
- Document dimensions
- Readable text
- Content hash
- Truncation status

The stored HTML snapshot limit is approximately **700,000 characters**. Larger pages fall back to a valid text-focused snapshot rather than saving incomplete HTML. Captured readable text is limited to approximately **120,000 characters**.

Snapshots are preservation aids, not forensic disk images or pixel-perfect screenshots. Linked assets such as images, fonts, and remote stylesheets may change or disappear later.

## Installation

### Requirements

- A modern desktop browser
- The Tampermonkey browser extension
- `webpage-annotation-overlay-v1.1.3.user.js`

### Install manually

1. Extract the ZIP package.
2. Open the Tampermonkey dashboard.
3. Open the existing Webpage Annotation Overlay script, or choose **Create a new script**.
4. Delete the old or starter code.
5. Copy the complete contents of `webpage-annotation-overlay-v1.1.3.user.js` into the editor.
6. Save the script.
7. Disable or remove older copies of Webpage Annotation Overlay.
8. Reload the webpage.

Do not leave v1.1.1, v1.1.2, or another copy enabled beside v1.1.3. Multiple active versions can create duplicate launchers or allow the older interface to continue affecting the page.

## Basic workflow

### Open the annotator

Click the floating **A** launcher or press:

```text
Alt + Shift + A
```

The panel begins collapsed each time the script initializes.

### Create a highlight

1. Select ordinary text on the webpage.
2. Click **Highlight**, or press `Alt + Shift + H`.
3. Enter the title, observation, category, severity, color, and tags.
4. Save the annotation.

Text selected inside the annotator interface is intentionally ignored.

### Create a margin note

1. Select **Note**.
2. Click the relevant location on the webpage.
3. Complete the annotation editor.
4. Save.

### Create a label

1. Select **Label**.
2. Click the desired page location.
3. Enter the visible label and supporting metadata.
4. Save.

### Create an arrow

1. Select **Arrow**.
2. Press and drag from the starting point to the ending point.
3. Release after drawing a meaningful distance.
4. Add the optional visible label and supporting observation.
5. Save.

### Review annotations

Open **Review** to:

- Search annotations on the current page
- Filter the findings list
- Focus and scroll to an annotation
- Edit an annotation
- Delete an annotation
- Undo the most recently created annotation
- Temporarily show or hide all annotation overlays

Press `Escape` to cancel an active drawing mode or close the current editor.

## Collection workflow

1. Open the collection menu using the **+** button beside the collection selector.
2. Create and describe a collection.
3. Assign the current webpage to the collection.
4. Visit additional pages and select the same collection.
5. Add annotations and snapshots.
6. Open **Collection overview** to review the assembled package.
7. Change the export scope to **Active collection** before exporting.

A page enters the indexed workspace after it contains an annotation, contains a snapshot, or is intentionally assigned to a collection.

## Export formats

All exports are generated locally in the browser.

### Native JSON

The complete backup and interchange format. It preserves page records, annotations, snapshots, collections, locators, metadata, and timestamps.

Native JSON can export:

- The current page
- The active collection

This is the only format intended for later re-import into Webpage Annotation Overlay.

### Trace Evidence Package

Structured JSON containing:

- Source records
- Quoted evidence
- Observations
- Severity and category information
- Tags
- Saved locators
- Snapshot metadata
- Page and collection summaries

### Critique Review

A Markdown review organized by source page and finding, suitable for editing or moving into a Critique workflow.

### Design Report Appendix

A Markdown appendix containing source records and grouped annotated observations for incorporation into a larger design report.

### Training Documentation

A standalone HTML document that organizes annotated webpages into readable training or reference material.

### Reliquary Project Record

Structured JSON for preserving annotated web sources as project artifacts, including provenance, annotations, snapshot data, source locations, and preservation notes.

### Evidence Snapshot HTML

A standalone viewer containing:

- The sanitized captured page in a sandboxed frame
- Source and capture metadata
- The content hash
- An annotation register

Snapshot HTML always exports the current page rather than an entire collection.

## Import and backup

Use **Import native JSON** from the annotator settings.

For a page package, the script asks whether to:

- Replace the current page record
- Merge the imported annotations into the current page

For a collection package, the script creates a new imported collection and restores the packaged page records into Tampermonkey storage.

Create Native JSON backups for important work. Tampermonkey storage is tied to the current browser profile and may be removed if the extension, profile, or browser data is deleted.

## Anchoring model

### Text highlights

Highlights save a text-quote anchor containing:

- The exact selected text
- Text immediately before the selection
- Text immediately after the selection
- The original character position

When the page reloads, the script searches the current document and selects the closest matching passage. This is more resilient than relying only on a DOM path, but a major wording change can still prevent re-anchoring.

### Notes and labels

Point annotations save an element-relative anchor when possible and document-coordinate fallback data.

### Arrows

Arrows preserve two point anchors: a start anchor and an end anchor.

## Site compatibility

Version 1.1.3 uses the same proven Shadow DOM mounting pattern as Link Garden:

- The userscript host is fully isolated before it is inserted into the page
- The host is fixed outside the site's normal document flow
- The host ignores pointer events except on active annotator controls
- The interface uses a normal stylesheet inside the Shadow DOM
- Dynamic positions and colors are applied directly to annotation elements

This change prevents an unstyled interface from expanding into the host page on strict sites such as LinkedIn.

The script is designed for ordinary HTTP and HTTPS webpages, including many single-page applications. Compatibility may still be limited on pages built primarily with canvas, WebGL, closed Shadow DOM, virtualized content, or cross-origin frames.

## Privacy and data handling

- There is no built-in server component.
- Annotations and snapshots are stored locally through Tampermonkey.
- Exports are generated locally and downloaded by the browser.
- The script does not intentionally transmit annotation data to Field Instruments or another service.
- Snapshot documents may preserve references to remote assets. Opening an exported snapshot can cause the browser to request those assets from the original site or third parties.
- Avoid capturing sensitive pages unless the browser profile and exported files are handled appropriately.

## Known limitations

- The script runs only on pages matching `http://*/*` and `https://*/*`.
- It cannot run on browser settings, extension stores, new-tab pages, or other protected browser URLs.
- The `@noframes` setting prevents the userscript from loading as a separate instance inside frames.
- Content inside cross-origin iframes cannot be annotated directly.
- Browser-native PDF viewers are not guaranteed to work correctly.
- Highly dynamic pages may replace anchored content after rendering.
- Major text changes may prevent highlights from re-anchoring.
- Point annotations can shift when a site substantially changes its layout.
- Structural snapshots are not pixel-perfect screenshots.
- Canvas, WebGL, virtualized lists, and closed Shadow DOM interfaces may expose limited anchor targets.
- Clearing browser or Tampermonkey storage removes saved records unless they were exported first.

## Troubleshooting

### The interface appears as unformatted text across the top of a page

1. Confirm that the installed script reports **v1.1.3**.
2. Disable or delete all older Webpage Annotation Overlay scripts.
3. Save the current script in Tampermonkey.
4. Hard reload the webpage.
5. Confirm that only one **A** launcher appears.

This symptom was addressed in v1.1.3 by replacing the earlier constructable-stylesheet implementation with the isolated Shadow DOM mounting pattern used by Link Garden.

### The launcher does not appear

- Confirm that the script is enabled.
- Reload the webpage after installation.
- Confirm that the page uses an HTTP or HTTPS URL.
- Check Tampermonkey's permission to run on the current site.
- Review the browser developer console for userscript errors.

### The panel opens automatically

Version 1.1.3 should initialize collapsed. Confirm that older versions are disabled and that the script header shows `@version 1.1.3`.

### Highlight says to select text first

Select ordinary webpage text before pressing **Highlight**. Selections inside the annotator panel do not count.

### An annotation is no longer in the correct location

The source page may have changed. Open the annotation from Review, preserve its quoted text and note, then recreate the visual anchor if necessary.

### A snapshot is text-only

The page exceeded the HTML snapshot size limit. The script created a smaller text-based snapshot rather than storing incomplete HTML.

### An exported snapshot looks different from the live webpage

Snapshots remove scripts and embedded content for safety and portability. Sites that rely heavily on JavaScript, authenticated APIs, canvas rendering, or temporary assets will not reproduce exactly.

### A collection export is missing a page

Open the page and do at least one of the following:

- Assign it intentionally to the collection
- Add an annotation
- Capture a snapshot

Empty and unassigned pages are not indexed.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Alt + Shift + A` | Open or collapse the annotator |
| `Alt + Shift + H` | Highlight the current webpage selection |
| `Escape` | Cancel the active tool or close the editor |

## Tampermonkey menu commands

- Toggle Web Annotator
- Highlight current selection
- Capture page snapshot
- Export current page JSON
- Export active collection JSON
- Clear annotations on this page

## Userscript metadata

- **Name:** Field Instruments — Webpage Annotation Overlay
- **Version:** 1.1.3
- **Namespace:** `https://mbparks.com/fieldinstruments`
- **Run timing:** `document-idle`
- **Page scope:** HTTP and HTTPS pages
- **Frame behavior:** `@noframes`
- **Granted APIs:** `GM_getValue`, `GM_setValue`, `GM_deleteValue`, `GM_registerMenuCommand`
- **External libraries:** None

## Package contents

```text
webpage-annotation-overlay-v1.1.3/
├── webpage-annotation-overlay-v1.1.3.user.js
└── README.md
```

## Version history

### 1.1.3

- Replaced constructable stylesheets with a normal Shadow DOM stylesheet
- Adopted the proven host-mounting approach used by Link Garden
- Fixed the unformatted interface expansion seen on LinkedIn
- Isolated the host before insertion so controls cannot enter the site's document flow
- Applied dynamic annotation positions directly to their elements
- Preserved collapsed startup behavior
- Preserved existing annotations, collections, and snapshots

### 1.1.2

- Attempted stricter content-security-policy compatibility using constructable stylesheets
- Retained existing annotation and collection data compatibility

### 1.1.1

- Changed the default startup state so the annotator begins collapsed
- Kept the compact **A** launcher visible
- Added `Alt + Shift + A` dock toggling

### 1.1.0

- Added multi-page collections
- Added collection overview and collection-level exports
- Added sanitized evidence snapshots
- Added standalone evidence snapshot HTML export
- Added page or collection export scope
- Expanded Trace, Critique, Design Report, Training, and Reliquary handoff packages
- Improved single-page-application navigation and autosave handling
- Preserved compatibility with version 1.0 page records

### 1.0.0

- Initial release
- Added highlights, margin notes, arrows, and labels
- Added per-page persistence and review controls
- Added native and Field Instruments-oriented exports

## License

No license has been assigned in this package. Add the license that matches the intended distribution and reuse terms before publishing the userscript publicly.

---

Built as part of the **Field Instruments** collection by Michael Parks.
