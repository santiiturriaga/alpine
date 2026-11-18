<a href="https://santiiturriaga.github.io/alpine/"><img src="docs/opening.gif" width="100%" alt="A flyover of Whistler Blackcomb, with stops at Creekside, a skier’s jump, the PEAK 2 PEAK gondola, and the summit inukshuk"></a>

# Alpine Descent

You start with your skis on, just outside the Whistler Village Gondola at Roundhouse Lodge. Push off toward Ego Bowl, walk over to the Olympic rings, or board the red PEAK 2 PEAK gondola and watch Blackcomb come into view. [Play in your browser](https://santiiturriaga.github.io/alpine/)

There are four resorts to explore. Open **Mountain → Resort** to travel, or start at [Whistler Blackcomb](https://santiiturriaga.github.io/alpine/), [Stevens Pass](https://santiiturriaga.github.io/alpine/?mountain=stevens-pass), [The Summit at Snoqualmie](https://santiiturriaga.github.io/alpine/?mountain=snoqualmie), or [Crystal Mountain](https://santiiturriaga.github.io/alpine/?mountain=crystal-mountain).

## Your first run

Press **W** to push off, **A** and **D** to carve, and **S** to brake. Hold **W** at speed to tuck. Press **Space** to jump or slow to a stop and press **B** to walk. **C** changes your view. Click the snow to look around with the mouse.

Press **M** to open the trail map. Pick a run, lift, or landmark and choose **Set destination**. Amber arrows on the snow guide you there. At a lift, **E** boards or skips the ride. Inside a gondola you can walk to the window and look down at the valley.

For company, have a friend open the same resort and drop in. You’ll join the same lobby automatically. Open **G → Multiplayer** to copy the mountain link, check the leaderboard, or switch to solo play. A wipeout resets your trick streak. Set your name and units under **Skier profile**, where you can also see your explored runs, mountains, and lifetime distance.

## Around the mountain

- Talk to Morgan at Roundhouse to start the Patrol Airlift. Follow the crew down to the helipad, then use the compass to reach both pickups. Slow to a hover and press **E** to lower the rope. The Patrol Shell doubles landing trick points while equipped.
- The mountain runs on a 20-minute day. Crowds peak around midday and thin after dark. Under **G → Conditions**, choose fixed lighting or **Peak crowds** to see how skier traffic packs the snow.
- Open **G** for the Blackcomb Glacier cave, Springboard race, Whiskey Jack slalom, or summer biking. **L** opens the outfitter. Your gear, coins, field photos, and profile save in your browser.
- Press **Esc** for graphics quality, the separate **Realism** lighting toggle, and the Field Guide.

## Run it locally

From the repository directory, start a static server and open [localhost:8080](http://localhost:8080/).

```sh
python -m http.server 8080 --bind 127.0.0.1
```

The game runs in a WebGL browser with a bundled copy of Three.js. Multiplayer uses a public WebSocket broker to exchange temporary player IDs, display names, positions, and session scores. [Multiplayer service](https://www.emqx.com/en/mqtt/public-mqtt5-broker)

The trail map and the terrain you ski share the same elevation data and mapped routes. Trees, buildings, and lift machinery are modeled in code. Building interiors, trail widths, and some lift dimensions are estimates. [Geography and credits](data/README.md) · [Add a resort](data/mountains/README.md)
