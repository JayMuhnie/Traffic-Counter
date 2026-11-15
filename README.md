# TMC Counter

Intersection turning-movement counter for iPad. Static web app (PWA) — no build step, no backend.

## Deploy (Cloudflare Pages)
1. Put these files at the root of a GitHub repo.
2. Cloudflare Pages → Create project → connect the repo.
3. Framework preset: **None**. Build command: *(empty)*. Output directory: `/`.
4. On each iPad, open the Pages URL in Safari → Share → **Add to Home Screen**. Open it once online so it caches; it then works offline.
   After an update, open the app once while online, then close it fully and reopen it.

## Using it
- **Setup:** name the site and set the legs. Each leg has a name and a direction (N, NE, E, ... — N is the top of the screen). A live preview shows the layout. 3 to 6 legs; a T-intersection is just N, E, W (or similar).
- **Counting:** the count screen is a diagram of the intersection. Pick Vehicles / Bicycles / Pedestrians (and Car / Truck / Bus), then tap the arrow button on the approach the vehicle is arriving from. Buttons sit in the lane driving toward the junction and are ordered left, through, right, U-turn. Each button shows its count for the current 15-minute interval. The last button tapped keeps a yellow outline.
- **Pedestrians:** two buttons on each crosswalk, one per walking direction (labelled with the compass direction walked). The movements CSV records the walking direction too.
- **Last counted / Recent:** the bar under the title shows the last tap with Undo. Recent lists the last 25 taps so a miscount can be fixed or removed later.
- **Notes:** timestamped notes with quick tags; included in the results and the intervals CSV.
- **Legs:** add, rename, move or remove legs at any time, even mid-count. Removed legs keep their recorded counts.
- **Peak hour:** the best four consecutive 15-minute intervals by total vehicles (cars + trucks + buses), whole intersection. Also shows peak hour factor, heavy-vehicle share, and the peak-hour movement matrix.
- **Export:** intervals CSV (with peak-hour flag, summary, legs and notes) and movements CSV (every interval x movement x class).

## Notes
- Data is stored in the browser's local storage on each iPad. Export the CSVs after each count.
- Stop on a 15-minute mark for a clean last interval; partial first/last intervals are flagged in the results.
- Right-hand traffic is assumed when placing the approach buttons.
