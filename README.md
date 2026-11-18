<a href="https://santiiturriaga.github.io/alpine/"><img src="docs/opening.gif" width="100%" alt="A flyover of Whistler Blackcomb, with stops at Creekside, a skier’s jump, the PEAK 2 PEAK gondola, and the summit inukshuk"></a>

# Alpine Descent

You start with your skis on, just outside the Whistler Village Gondola at Roundhouse Lodge. Push off toward Ego Bowl, walk over to the Olympic rings, or board the red PEAK 2 PEAK gondola and watch Blackcomb come into view. [Play in your browser](https://santiiturriaga.github.io/alpine/)

There are four resorts to explore. Open **Mountain → Resort** to travel, or start at [Whistler Blackcomb](https://santiiturriaga.github.io/alpine/), [Stevens Pass](https://santiiturriaga.github.io/alpine/?mountain=stevens-pass), [The Summit at Snoqualmie](https://santiiturriaga.github.io/alpine/?mountain=snoqualmie), or [Crystal Mountain](https://santiiturriaga.github.io/alpine/?mountain=crystal-mountain).

## Your first run

Press **W** to push off, **A** and **D** to carve, and **S** to brake. Hold **W** at speed to tuck. Press **Space** to jump or slow to a stop and press **B** to walk. **C** changes your view. Click the snow to look around with the mouse.

Press **M** to open the trail map. Pick a run, lift, or landmark and choose **Set destination**. Amber arrows on the snow guide you there. At a lift, **E** boards or skips the ride. Inside a gondola you can walk to the window and look down at the valley.

For company, have a friend open the same resort and drop in. You’ll join the same lobby automatically. Open **G → Multiplayer** to copy the mountain link, check the leaderboard, or switch to solo play. A wipeout resets your trick streak.

## Around the mountain

- At Roundhouse, look for a **?** above a guest. Take a wildlife photo, deliver a lunch order, or join Morgan’s helicopter rescue. Return to the person who asked to collect your reward.
- Open **G** to race on Springboard, try the Whiskey Jack slalom, change the weather, or take a summer bike ride. **L** opens the outfitter. Gear, coins, and field photos save in your browser.
- Press **Esc** to pause, change graphics quality, or open the Field Guide for the rest of the controls.

## Run it locally

From the repository directory, start a static server and open [localhost:8080](http://localhost:8080/).

```sh
python -m http.server 8080 --bind 127.0.0.1
```

The game runs in a WebGL browser with a bundled copy of Three.js. Multiplayer uses a public WebSocket broker to exchange temporary player IDs, positions, and session scores. [Multiplayer service](https://www.emqx.com/en/mqtt/public-mqtt5-broker)

The trail map and the terrain you ski share the same elevation data and mapped routes. Trees, buildings, and lift machinery are modeled in code. Building interiors, trail widths, and some lift dimensions are estimates. [Geography and credits](data/README.md) · [Add a resort](data/mountains/README.md)
