# jrabbit: "What your agent gets" loop

7.0s seamless loop, 30fps (210 frames), 1280x800, no audio. Replaces the JSON block in #agent.

## Angle (v2)
One pin, start to finish: point at "Start trial", ask for the primary button, Send, the agent reads it, the button fills green.
v1 halved a gap (48 → 24px); too subtle at column width. v2 swaps outline → filled accent: readable at 640px wide.
The viewer should leave with two facts: the agent gets the file and line, and the fix lands in the page.

## Style
White #fff, ink #000, ink-2 #5c5c5c, line #e4e4e2, accent #b4ff39 (selection, Send, diff mark only).
Instrument Sans for the app UI, JetBrains Mono for overlay + agent. Pixel rabbit in the toolbar.
Only dark element: the small overlay toolbar (mirrors the real widget). Composer is white with ink hairline.

## Stage
A 2-panel strip, 2 x 1280 wide. Camera pans between them.
- Panel A, "your app": browser window, pricing card (Pro / $24 / month / Start trial), toolbar bottom-right.
- Panel B, "your agent": terminal-style white window, mono lines.

## Storyboard
| t (s) | Beat |
|---|---|
| 0.0-0.7 | App at rest, outline "Start trial". Cursor enters, clicks Point. |
| 0.7-1.2 | Hover frame + tag `button.cta` on the button, click: green selection + handles. |
| 1.2-2.3 | Composer opens right of the card, comment types, Add pin, marker 1 drops. |
| 2.3-2.7 | Cursor to Send ("Send 1"), press. |
| 2.7-3.2 | Pan right to agent (ease-in-out). |
| 3.2-4.75 | Lines print: pin, comment, selector `variant outline`, PlanCard.tsx:52, screenshot thumb, edit `variant="outline" → "primary"`. Hold. |
| 4.75-5.2 | Pan back to app. |
| 5.3-5.8 | Selection steps aside, accent fill wipes left → right (ease-out), marker turns into a check. Hold ~0.7s. |
| 6.5-7.0 | Pixel rabbit runs right → left; behind it the page is back to frame 0. |

## Delivery
brag.mp4 (H.264, yuv420p, faststart), brag.webm (VP9), brag.jpg poster (settled agent frame), share-copy.txt.
