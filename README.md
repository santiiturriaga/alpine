<a href="https://santiiturriaga.github.io/alpine/assets/opening.mp4"><img src="docs/opening-poster.jpg" width="100%" alt="Watch the Whistler Blackcomb preview, with footage of Creekside, a skier’s jump, the PEAK 2 PEAK gondola, and the summit inukshuk"></a>

[Download the 24-second 1080p preview](assets/opening.mp4?raw=true)

# Alpine Descent

You start with your skis on, just outside the Whistler Village Gondola at Roundhouse Lodge. Push off toward Ego Bowl, walk over to the Olympic rings, or board the red PEAK 2 PEAK gondola and watch Blackcomb come into view. [Play in your browser](https://santiiturriaga.github.io/alpine/)

Open **Mountain → Resort** to choose from 13 ski regions and seven summit areas. Ski the measured runs of Les 3 Vallées, Zermatt–Cervinia, Chamonix, Ski Arlberg, Verbier, Tignes–Val d’Isère, Vail, Jackson Hole, and Niseko. The summit areas start on foot and include viewpoints on Rainier, Mont Blanc, the Matterhorn, Eiger, Denali, Everest, and K2.

## Your first run

Press **W** to push off, **A** and **D** to carve, and **S** to brake. At speed, **S** starts a parallel hockey stop. Hold **A** or **D** to choose the side. Hold **W** at speed to tuck, press **Space** to jump, or stop and press **B** to walk. **C** changes your view. Click the slope to swing a pole at low speed and look around with the mouse.

Press **M** to open the trail map. Pick a run, lift, or landmark and choose **Set destination**. Amber arrows on the snow guide you there. At a lift, **E** boards or skips the ride. Inside a gondola you can walk to the window and look down at the valley.

For company, have a friend open the same resort and drop in. You’ll join the same lobby automatically. Open **G → Multiplayer** to copy the mountain link, check the leaderboard, or switch to solo play. A wipeout resets your trick streak. Set your name and units under **Skier profile**, where you can also see your explored runs, mountains, and lifetime distance.

## Around the mountain

- Talk to Morgan at Roundhouse to start Patrol Airlift. Follow the crew to the helipad, use the compass to find each pickup, and press **E** inside the gold hover zone. Use **Copy winch seat invite** in the Mountain menu to bring a second skier. The operator can hold **W** to lower, press **E** beside the patient, and hold **S** to reel them in. The Patrol Shell doubles landing trick points while equipped.
- The mountain runs on a 20-minute day. Under **G → Conditions**, choose **Golden Hour**, **Extreme Whiteout**, or **Peak crowds**. Mapped night-skiing zones light up after dark.
- Open **G → Sled Run** to race White Fir Chute. Steer around the trees and rolling snowballs, then time your jumps off the ramps to cross the gaps.
- Open **G** for the Blackcomb Glacier cave, Springboard race, Whiskey Jack slalom, or summer biking. **L** opens the outfitter. Your gear, coins, field photos, and profile save in your browser.
- Press **Esc** for graphics quality, the separate **Realism** lighting toggle, and the Field Guide.

## Run it locally

From the repository directory, start a static server and open [localhost:8080](http://localhost:8080/).

```sh
python -m http.server 8080 --bind 127.0.0.1
```

The game runs in a WebGL browser with a bundled copy of Three.js. Multiplayer uses a public MQTT broker over WebSockets. The browsers exchange temporary IDs, names, motion, and scores in resort-specific rooms. Each browser interpolates remote skiers locally. The game disconnects an idle session after five minutes. [Multiplayer service](https://www.emqx.com/en/mqtt/public-mqtt5-broker)

The trail map and the terrain you ski share the same elevation data and mapped routes. Trees, buildings, and lift machinery are modeled in code. Building interiors, trail widths, and some lift dimensions are estimates. [Geography and credits](data/README.md) · [Add a resort](data/mountains/README.md)
