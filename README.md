# TMC Counter

Intersection turning-movement counter for iPad. Static web app (PWA) — no build step, no backend.

## Deploy (Cloudflare Pages)
1. Put these files at the root of a GitHub repo.
2. Cloudflare Pages → Create project → connect the repo.
3. Framework preset: **None**. Build command: *(empty)*. Output directory: `/`.
4. On each iPad, open the Pages URL in Safari → Share → **Add to Home Screen**. Open it once online so it caches; it then works offline.

## Using it
- **Setup:** name the site, set the legs (clockwise order), start. "Start at next 15-minute mark" aligns intervals to the clock (07:00, 07:15, …).
- **Counting:** pick Vehicles / Bicycles / Pedestrians. For vehicles pick Car, Truck or Bus, then tap the movement (approach → exit). U-turn is the last button on each leg.
  Pedestrians are counted per crosswalk (crossing leg X, walking toward the neighbouring leg).
- **Legs:** add, rename, reorder or remove legs at any time, even mid-count. Removed legs keep their recorded counts.
- **Undo** removes the last tap. **Stop** ends the count and opens results.
- **Peak hour:** the best four consecutive 15-minute intervals by total vehicles (cars + trucks + buses), whole intersection. Also shows peak hour factor, heavy-vehicle share, and the peak-hour movement matrix.
- **Export:** intervals CSV (with peak-hour flag and summary) and movements CSV (every interval × movement × class).

## Notes
- Data is stored in the browser's local storage on each iPad. Export the CSVs after each count.
- Stop on a 15-minute mark for a clean last interval; partial first/last intervals are flagged in the results.
- Vehicle movement order on a 4-leg intersection is right / through / left, assuming legs are listed clockwise.
