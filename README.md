# TMC Counter

Intersection turning-movement counter for iPad. Static web app (PWA) — no build step, no backend.

## Deploy (Cloudflare Pages)
1. Put these files at the root of a GitHub repo.
2. Cloudflare Pages → Create project → connect the repo.
3. Framework preset: **None**. Build command: *(empty)*. Output directory: `/`. (The `_headers` file makes Cloudflare re-check files on every load so updates arrive.)
4. On each iPad, open the Pages URL in Safari → Share → **Add to Home Screen**. Open it once online so it caches; it then works offline.
   After an update, open the app once while online, then close it fully and reopen it.

## Using it
- **Setup:** name the site, add the observer and the weather conditions, and set the legs. Each leg has a name and a direction (N, NE, E, ... — N is the top of the screen). A live preview shows the layout. 3 to 6 legs; a T-intersection is just N, E, W (or similar).
- **Counting:** the count screen is a top-down diagram of the intersection. Each leg shows its movement buttons laid out the way the driver sees the road: on the north leg, Right | Thru | Left from left to right on screen, with U-turn behind. Tap the button for the movement. Each button shows its count for the current 15-minute interval, and the last button tapped keeps a yellow outline. Intersections with more than 4 legs or diagonal legs use a compact layout instead (buttons stacked along each leg, with a Vehicles / Pedestrians toggle).
- **Names and fit:** leg names sit in the grass beside the end of each road (long names wrap to two lines). The count screen is locked to the screen size, so it doesn't scroll.
- **Intervals:** the interval changes by itself every 15 minutes. Use the ◀ ▶ buttons by the interval time to step back to an earlier interval; taps are then added to that interval, and the screen turns tan. **Live** (or 60 s with no taps) returns to the current interval.
- **Remove counts:** tap *− Remove counts*, then tap a button to take one count out of the interval being shown (works in earlier intervals too). It switches itself off after 20 s of no taps.
- **Classes:** Car is the default. Tap Heavy vehicle or Bike and the next count uses that class, then it drops back to Car. Double-tap to keep it selected (shown with a lock); tap Car to switch back. Bike counts appear as a small purple bubble on the movement and in the Bike total.
- **Pedestrians:** two flat buttons on each crosswalk, one per walking direction, always on the diagram.
- **Last counted / Recent:** the bar under the title shows the last tap with Undo. Recent lists the last 25 taps so a miscount can be fixed or removed later.
- **Notes:** timestamped notes with quick tags; included in the results and the intervals CSV.
- **Legs:** add, rename, move or remove legs at any time, even mid-count. Removed legs keep their recorded counts.
- **Peak hour:** the best four consecutive 15-minute intervals by total vehicles (cars + heavy vehicles), whole intersection. Only complete 15-minute intervals count: a partial first or last interval is never part of the peak hour, and a count shorter than one full hour has no peak hour (the PDF then shows a labelled "not available" page with everything counted). Also shows peak hour factor, heavy-vehicle share, and the peak-hour movement matrix.
- **Summary PDF:** the *Summary PDF* button on the results screen shows a preview. Pages: full-count diagram, peak-hour diagram, then tables for cars, heavy vehicles, bicycles and pedestrians (peak hour shaded). The diagrams have a "How to read this page" key and show, for every movement, the vehicles (cars + heavy vehicles), the share that were heavy vehicles, and the bicycles (bicycle symbol); pedestrians at each crosswalk (pedestrian symbol); each street's approach total of vehicles; and the time period in the middle of the intersection (with the peak hour factor on the peak page). Intersections with 5+ legs or diagonal legs get one small table per approach instead. The date includes the weekday, and the weather is shown if entered.
- **Export:** tap an export button and a panel lists the file(s); tap *Share / Save* on each (or *Open*). One Excel file with three sheets, or the same three sheets as separate CSV files. Rows are 15-minute intervals; columns are grouped by leg as Left, Thru, Right (plus U-turn if any were counted). *Summary*: cars + heavy vehicles per movement, total vehicles, bicycles, pedestrians, peak-hour flag, totals, peak-hour row, PHF, legs and notes. *Vehicles*: cars and heavy vehicles as separate tables. *Bikes and Peds*: bicycles by movement, pedestrians by crosswalk and walking direction.

## Older iPads (iOS 12 and similar)
- Web browsers on iOS 12 cannot send files (Excel, PDF, CSV) from a Home Screen app. On these iPads the export panel offers *Share as text*, *Email text* and *Copy* (paste into Excel or Numbers; columns split into cells), and the PDF preview shows each page as a picture: touch and hold it, then *Save Image* or *Share*.
- On iOS 15 and newer, *Share / Save* opens the normal share sheet (email, AirDrop, Save to Files) for PDF and CSV files.

## Notes
- Data is stored in the browser's local storage on each iPad. Export the CSVs after each count.
- Stop on a 15-minute mark for a clean last interval; partial first/last intervals are flagged in the results.
- Right-hand traffic is assumed when placing the approach buttons.

## Updates
- The app checks for a newer version whenever it is opened or brought back to the front (and every 5 minutes) while online. On the setup or results screen it installs itself; during a count a green "Update available" button appears instead, and you tap it when convenient. Counts are kept. Setup screen: "Check for updates" button.

## If an iPad shows an old version (only needed once, to get a version older than 10 onto the new updater)
- The setup screen shows the app version at the bottom. Compare it with the version you deployed.
- Export any counts you want to keep first, then: Settings -> Safari -> Advanced -> Website Data -> delete the site (this erases the counts saved on that iPad). Remove the Home Screen icon, reopen the link in Safari, and add it to the Home Screen again.
- From version 4 on, a new version installs itself the next time the app is opened online (it will not reload in the middle of a count).

## v15
- PDF diagram: arrows and numbers are fitted inside each movement card for 1–3 digit counts.
- Intersection name is the header on every PDF page.
- Short counts: centre label reads "PEAK HOUR" (with a "less than a full hour" note).
- Sound: count taps now play short audio clips (they sound even with the side mute switch on) with a Web Audio fallback. Check the 🔊 toggle and volume.

## v16
- Results page tidied: four headline tiles, a Peak hour row under the interval totals (replaces the bikes/peds tile), Notes card has its own Add/Edit button, and Export (PDF, Excel, CSV) is one grouped card. Resume / New count / Past counts are a separate row.

## v17
- Excel (4 sheets) and CSV (4 files) now contain only the Cars, Heavy vehicles, Bikes and Pedestrians tables. The summary sheet, legs row, "In peak hour" column and peak-hour rows are gone.
- Results page: buttons moved to the top under the warnings; the four export tables are shown as a tabbed preview; Notes card only appears when there are notes.

## v18
- Results page: 15-minute interval table removed; action buttons are a symmetrical bar at the very top.
- Bikes and Pedestrians tables (preview, Excel, CSV) now have an "Approach total" column after each leg.

## v19
- Pedestrian tables: group headers read "<street> leg"; sub-columns read West / East etc. (no "Walking").
- Faster counting: a count registers on finger-down (several fingers can tap at once), the screen updates first, sound plays after (never blocks the next tap), saving to storage is batched (~0.6 s, and always flushed when the app is hidden/closed), and each sound rotates between 3 audio copies.

## v20
- Pedestrian group headers match the other tables ("Bank Street (N)"). In Bikes and Pedestrians the per-leg column is "Total" and the last column is "Grand total".

## v21
- Pedestrian columns use one order on every leg (West before East, North before South).
- Count screen: Veh/Bike/Ped totals removed; Stop is pinned to the far right.

## v22
- Pedestrian columns: East before West, South before North, on every leg (table, PDF, preview).
- Verified with an automated test that every count-screen pedestrian and vehicle button lands in the matching table column.
- Summary PDF is now portrait US Letter (612 x 792 pt), and the preview shows a true letter page. The site name, page title, details and legend are one header band at the top.
- New diagram palette: light grey-blue roads with white dashes, white movement cards, blue arrows/street names, amber heavy %, violet bikes, green pedestrians.

## v23
- PDF diagram: simpler palette (greys plus one blue accent); "How to read this page" legend removed.

## v24
- U-turn button on the count screen is now the same size and style as the other turn buttons, labelled "U-TURN", and lined up with the left-turn column (it was a small flat strip, rotated on east/west legs).
- PDF diagram: U-turn card is the same 100x100 size as the others and aligned with the left-turn column (it was 104 wide and 8 units off).

## v25
- PDF: "Counted" -> "Time period:"; titles in title case (Full Count — All Volumes, Peak Hour, Passenger Vehicles, Heavy Vehicles, Bicycles, Pedestrians); observer name removed from headers and footer.
- Pedestrian columns: North before South (East still before West) everywhere.

## v26
- Setup page restyled to match the PDF: white header band with blue top bar, title-case headings, neutral cards, one blue accent, blue Start Count button, narrower centred form.
- PDF preview window: Share / Save PDF and Open are now equal-width, same-height buttons; the iOS 12 note is a compact tip box.
- Fixed a regression from v18: the intersection preview on the setup page (leg editor) was missing.

## v27 — test tools
- Setup screen → **Test Tools**: (1) Self-test runs ~33 checks on the device's own JS engine against answer keys computed separately in Python; (2) Demo count loads a finished 183-tap count with an expected-vs-app check table; (3) Time-jump count lets you tap a short recipe on the real count screen, with a **+15** button that jumps the clock to the next interval.
- Test counts are flagged (`S.test`), use a shifted clock `NOW()`, and are never saved to Past counts.
- Added `selftest.js` (cached by the service worker, `tmc-v27`).

## v28
- Recent / Undo / toast text now describes vehicle and bike movements by direction of travel and turn: SBR, NBL, EBT, WBU, etc. (BL/BR/SL/SR for bear/sharp turns on non-90° legs). Pedestrians unchanged.

## v29
- Pedestrian entries in Recent/Undo now read e.g. "North leg · EB" (crosswalk leg, walking direction).

## v30
- Pedestrian entries use the leg's compass side ("North leg · EB"), not its street name.
