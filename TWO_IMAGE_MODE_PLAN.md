# Plan: Two-image observation mode

## Goal

Make the two-picture experiment the default in the demo, loading each set from
`demo/images_v2` as `<round>a.jpg` and `<round>b.jpg`. Keep the existing
four-picture experiment available to the experiment operator, loading its
`a`–`d` images from `demo/images` and preserving its current 2×2 presentation
and round workflow.

Keep implementation within the demo UI and rendering layer (`demo/index.html`,
`demo/styles.css`, and `demo/app.js`). Do not change the eye-tracking library,
calibration, gaze resolution, or tracking algorithms.

## Existing behavior and constraints

- `demo/index.html` contains four fixed image cards (`card-a` through `card-d`).
- `demo/app.js` loads a round by assigning `images/<round><suffix>.jpg` to all
  four slots. It starts at round 1 and advances while a `HEAD` request for the
  next round's `a.jpg` succeeds.
- Observation currently calls `tracker.observe()` with the broad selector
  `.card, .overlap-wrapper, .overlap-front`. `EyeTracker.observe()` resolves
  that selector once, when observation starts; changing which cards are shown
  must therefore also change the targets passed at start.
- The calibration grid uses viewport coordinates at 10%, 50%, and 90% on each
  axis. The demo's detection-range drawing depicts these points and describes
  the confident zone.
- `demo/images_v2` currently contains seven complete pairs, `1a.jpg` through
  `7b.jpg`. `demo/images` contains the existing seven four-picture rounds.
- Dwell statistics identify cards through `data-eye-id`; labels are also used
  in event messages and CSV export.

## Planned changes

### 1. Add an operator-facing observation-mode control

- Add a clearly labeled two-option control in the demo controls, near the
  round indicator or other experiment controls:
  - **Two pictures (default)** — assets in `images_v2`, suffixes `a` and `b`.
  - **Four pictures** — assets in `images`, suffixes `a`, `b`, `c`, and `d`.
- Initialize the application in two-picture mode on every page load. Do not
  persist a prior four-picture selection unless that behavior is explicitly
  requested later.
- Disable the mode control while observation is active. The operator can stop
  observation, switch modes, and start again; this avoids changing the
  experiment's stimuli while the tracker is observing a fixed target list.
- When switching modes while stopped, reset the round to 1, load that mode's
  first set, and update the round indicator and Next Set button state.
- Keep calibration independent of the selected mode; both layouts use the
  existing calibration.

### 2. Render the selected mode's assets and rounds

- Replace the hard-coded image path and four-slot update assumptions in the
  demo's round-loading flow with mode-aware selection of the image directory
  and active suffixes.
- Two-picture mode loads only `images_v2/<round>a.jpg` and
  `images_v2/<round>b.jpg`. Four-picture mode continues to load
  `images/<round>a.jpg` through `images/<round>d.jpg`.
- Keep the existing first-round initialization, Next Set control, round
  indicator, experiment-complete behavior, and legacy four-image filenames.
- Determine whether another set exists using the selected mode's directory
  and filenames. Do not treat a network/request error as proof that an
  experiment is complete; surface a load failure distinctly from the normal
  end-of-sets state. The current implementation catches every `HEAD` failure
  and treats it as “no more images,” so make the distinction explicit during
  this update.
- Hide or deactivate unused card slots. Two-picture mode must not show stale
  `c`/`d` images from the previous four-picture round or mode.
- Preserve meaningful image alt text, `data-label`, and `data-eye-id` values.
  Ensure IDs distinguish the same round/suffix from the two asset directories
  (for example, mode-qualified IDs) so dwell statistics from visually
  different assets cannot be accidentally combined. Keep readable image
  labels in the event log, stats table, and CSV.

### 3. Pass only visible image cards to gaze observation

- Replace the broad shared target selector for the demo's observation start
  with the currently active image-card elements only.
- In two-picture mode, the tracker target list must contain exactly cards A
  and B; in four-picture mode it must contain cards A through D.
- Do not include hidden cards or unrelated demo elements in either mode.
- Keep the existing gaze highlighting, 20-pixel tolerance, pointer, stats,
  event logging, and stop behavior otherwise unchanged.

### 4. Add mode-specific layout styling

- Preserve the existing four-picture 2×2 layout exactly as the legacy
  presentation.
- Add a two-picture layout variant with two equal-width cards in one centered
  horizontal row. Use `object-fit: contain` as today and keep the image cards'
  full rectangles as the tracked targets.
- Align the pair around the calibration grid's middle row. As a layout
  target, place card centers near one-third and two-thirds of the viewport
  width and near the viewport's vertical midpoint. Keep the complete card
  rectangles within the calibration points' 10%–90% viewport bounds, leaving
  margin for the existing 20-pixel gaze tolerance.
- Adapt card size and spacing to viewport dimensions so the pair remains
  visible without scrolling at supported desktop sizes. On narrower screens,
  retain the horizontal pair if each card can remain legible and within the
  confident zone; otherwise use a deliberate responsive layout that does not
  push either tracked card outside that zone.
- Keep the mode styling scoped to the image grid; do not change the detection
  visualization's meaning or the legacy four-card geometry.

## Suggested implementation sequence

1. Add the mode control and a small mode state initialized to two-picture
   mode.
2. Refactor round loading to use the selected mode's directory and active
   suffix list; initialize the first round from that state.
3. Update mode switching and set completion/loading states, including resetting
   to round 1 while stopped.
4. Mark active cards and use those elements as the observation target list.
5. Add a two-picture grid class and responsive styles, leaving the four-picture
   class behavior unchanged.
6. Verify that stats/event/export labels stay clear and that mode-qualified
   identifiers prevent cross-mode aggregation.

## Acceptance checks

- A fresh page load displays round 1's `images_v2/1a.jpg` and
  `images_v2/1b.jpg` in a centered horizontal pair; cards C and D are not
  visible or tracked.
- Starting observation in two-picture mode tracks only A and B. Gaze
  highlighting, event logging, dwell stats, pointer controls, stopping, and
  CSV export continue to work.
- Next Set loads all seven two-picture sets in order and completes after set 7.
- Switching to four-picture mode while stopped loads round 1 from `images/`,
  displays the existing four cards in the current 2×2 arrangement, and tracks
  all four. Advancing rounds and completion behave as they do today.
- Switching modes during observation is prevented. Switching while stopped
  resets the displayed set to round 1 and does not leave stale images or
  targets.
- A missing image set ends the experiment normally; a request/network failure
  is reported as an error rather than falsely declaring completion.
- At supported viewport sizes, both two-picture card rectangles stay within
  the calibration grid's 10%–90% viewport region and do not require scrolling.
- No changes are required in `src/` or the public eye-tracking API.
