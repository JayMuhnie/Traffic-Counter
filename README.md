# TMC Counter

Intersection turning-movement counter for iPad. Static web app (PWA) — no build step, no backend.

## Deploy (Cloudflare Pages)
1. Put these files at the root of a GitHub repo.
2. Cloudflare Pages → Create project → connect the repo.
3. Framework preset: **None**. Build command: *(empty)*. Output directory: `/`. (The `_headers` file makes Cloudflare re-check files on every load so updates arrive.)
4. On each iPad, open the Pages URL in Safari → Share → **Add to Home Screen**. Open it once online so it caches; it then works offline.
   After an update, open the app once while online, then close it fully and reopen it.

## Using it
- **Setup:** name the site and set the legs. Each leg has a name and a direction (N, NE, E, ... — N is the top of the screen). A live preview shows the layout. 3 to 6 legs; a T-intersection is just N, E, W (or similar).
- **Counting:** the count screen is a top-down diagram of the intersection. Each leg shows its movement buttons laid out the way the driver sees the road: on the north leg, Right | Thru | Left from left to right on screen, with U-turn behind. Tap the button for the movement. Each button shows its count for the current 15-minute interval, and the last button tapped keeps a yellow outline. Intersections with more than 4 legs or diagonal legs use a compact layout instead (buttons stacked along each leg, with a Vehicles / Pedestrians toggle).
- **Classes:** Car is the default. Tap Truck/Bus or Bike and the next count uses that class, then it drops back to Car. Double-tap to keep it selected (shown with a lock); tap Car to switch back. Bike counts appear as a small purple bubble on the movement and in the Bike total.
- **Pedestrians:** two flat buttons on each crosswalk, one per walking direction, always on the diagram.
- **Last counted / Recent:** the bar under the title shows the last tap with Undo. Recent lists the last 25 taps so a miscount can be fixed or removed later.
- **Notes:** timestamped notes with quick tags; included in the results and the intervals CSV.
- **Legs:** add, rename, move or remove legs at any time, even mid-count. Removed legs keep their recorded counts.
- **Peak hour:** the best four consecutive 15-minute intervals by total vehicles (cars + trucks + buses), whole intersection. Also shows peak hour factor, heavy-vehicle share, and the peak-hour movement matrix.
- **Export:** intervals CSV (with peak-hour flag, summary, legs and notes) and movements CSV (every interval x movement x class).

## Notes
- Data is stored in the browser's local storage on each iPad. Export the CSVs after each count.
- Stop on a 15-minute mark for a clean last interval; partial first/last intervals are flagged in the results.
- Right-hand traffic is assumed when placing the approach buttons.

## If an iPad shows an old version
- The setup screen shows the app version at the bottom. Compare it with the version you deployed.
- Export any counts you want to keep first, then: Settings -> Safari -> Advanced -> Website Data -> delete the site (this erases the counts saved on that iPad). Remove the Home Screen icon, reopen the link in Safari, and add it to the Home Screen again.
- From version 4 on, a new version installs itself the next time the app is opened online (it will not reload in the middle of a count).
