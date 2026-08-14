# Ant Raid

Two ant colonies, three roads between them, and one nest each. You spend sugar
on ants that march at the other player's nest, and on a handful of defenders to
make their ants regret trying the same. First nest to zero loses.

It is the offensive half of [Grubs TD](../ant-td): the same ants, in their own
world, except you are the wave now.

Play it four ways:

| | |
|---|---|
| **Play with a friend** | You get a room code, you send them the link, you raid each other. |
| **Together vs a bot** | Both of you on one side against a bot colony that gets a bigger allowance. |
| **Solo** | You against a bot, three difficulties. |
| **Hot-seat** | Two of you at one keyboard. One plays on the keys, one on the mouse. |

## Running it

```bash
npm install
```

```bash
npm start
```

Then open <http://localhost:5010>.

### Running more than one at once

A second copy of the game on the same machine takes the next free port instead
of dying, and says so:

```
Ant Raid on http://localhost:5011
  5010 was taken, so this one moved up to 5011
  sharing this machine with 1 other Ant Raid:
    port 5010  C:\...\ant-raid
```

Sliding only happens when the address is for you alone. Set `PORT` and the
server binds exactly that and fails loudly if it cannot, because `npm run
share`, `npm run lan` and a deployed instance have all told somebody else where
to look, and a server that quietly moved is a link that quietly broke. Use
`AR_PORT` to move the starting point while keeping the sliding, which is what a
second worktree wants:

```bash
AR_PORT=5030 npm start
```

Live instances register in `ant-raid-instances.json` in your temp directory, so
`node tools/netcheck.js` finds the right server on its own rather than assuming
5010. Dev screenshots land in `shots/<port>/` for the same reason: two dev
servers used to overwrite each other's captures, which looks exactly like your
change not working.

Two browser tabs on one server are two separate players. The second tab gets its
own name, colour, loadout and win record rather than sharing the first tab's,
which is what makes it usable for testing a real match against yourself.

### Three to six of you: every colony for itself

Host a room, pick **Every colony for itself**, send the link to everyone. Start
whenever three or more are in. The board is chosen by how many turned up: three
people play a triangle, six play a wheel.

Colonies sit in a ring and roads only ever join NEIGHBOURS, so you have exactly
two people who can hurt you and two you can hurt. You cannot touch the colony
opposite. That is the whole shape of the mode, because hitting one neighbour
softens them up for the colony on their far side as much as for you.

Your rail shows your four roads and nobody else's: two at each neighbour, named
for whoever is at the far end. A nest falling does not end the match, it just
takes that colony out, and the last one standing wins.

Those boards are wider (1280x860) and are generated rather than drawn. One
colony's wedge is authored and rotated, the same way the duelling boards author
one half and mirror it, so a six-colony board is exactly as fair as a
three-colony one and neither can drift.

### Four of you: two a side

Host a room, pick **Two a side** in the lobby, and send the link to all three of
them. The first two in share a colony with you; the last two get the other one.

A colony of two splits its four pads evenly, so you each hold two and cannot
build on your partner's. You each bring your own five ants and your own queen,
so a side fields two queens. The colour comes from whoever sat down first on
each side, because a colony is one colour.

One number changes for team play: a colony of two does not get to put twice as
many ants on the board as a lone player. Each of you can field 37 rather than
55, so a side tops out at 74 instead of 110. Without that, four purses feeding
one board peaked at 201 ants, and a frame at that count costs enough to drop
well under 60fps.

Expect a scrappier game than 1v1. Twice as many raiders meet in the lanes, so
far more of them die there: about 15% reach a nest against 32% in a duel.
Matches still land around five minutes.

### Playing with someone in the same house

```bash
npm run lan
```

It prints the address to send them, checks whether Windows Firewall will
actually let them through, and starts the game.

Windows blocks inbound connections that match no rule, so without one their
browser just hangs and nothing appears in your log. `npm run lan` gives you the
exact one-line fix to paste into an administrator PowerShell. It opens that one
port, on Private networks only, only to machines on your own subnet.

### Playing with someone who is not in the house

A `localhost` link cannot reach them, so the game needs an address that can. For
one evening, this is the whole thing:

```bash
npm run share
```

It opens a temporary Cloudflare tunnel (no account, no signup), prints an
`https://…trycloudflare.com` address, and starts the server behind it. Open that
address yourself, host a room, and the link in the lobby is one you can send. The
tunnel lives as long as the command runs and your machine stays awake.

The lobby tells you which of these you have, so you never send a link that cannot
work:

| | |
|---|---|
| **Anyone can open this** | A public address. Send it however you like. |
| **Same wifi only** | Your network can reach it, the outside world cannot. |
| **This computer only** | `localhost`. Nobody else can open it. |

For something that stays up without your PC on, deploy it once: see
[DEPLOY.md](DEPLOY.md).

## How a match goes

**Raiding is your economy.** Every raider you send permanently raises your income,
and cheap ants pay best per sugar: an Army Ant costs 130 and returns +1.65/second,
a Majoress costs 420 and returns +0.60. Passive income is a trickle (10 rising to
18) that exists only so a wiped-out colony can still act. Sitting on your hands
earns you almost nothing.

That is the whole tension. Early on you raid for the income even though those ants
will die; later you raid for the damage even though the income is worse. The taper
matters too: a raid is worth less the richer you already are, so an early lead
cannot be compounded into an unanswerable one.

**Getting bitten pays you back.** When a raider reaches your nest you get sugar,
and more of it the further behind you already are. A deficit funds the counter-push
instead of being pure loss.

**You bring five of the seven raiders.** You pick them before the match and you can
see what your opponent packed. Two colonies on the same board with the same economy
still play differently because they packed differently.

**Raiders** walk down whichever road you send them. They fight enemy raiders they
meet, and when they reach the far nest they take a bite out of it and die doing it.
Seven to choose five from:

| | Cost | Income | What it is for |
|---|---|---|---|
| Worker | 60 | +0.95/s | Two per purchase. The best income per sugar in the game. |
| Army Ant | 130 | +1.65/s | Three, fast, made of paper. The fastest way to grow your income. |
| Trap-Jaw | 200 | +1.40/s | Walks into a lane fight and keeps walking. Your front rank. |
| Exploder | 170 | +0.80/s | Detonates on its first hit. Clears a column or cracks a pad. |
| Weaver | 190 | +1.00/s | Silk from the back rank. Everything it touches crawls. |
| Acid Archer | 240 | +1.10/s | Outranges the pads. The answer to a lane you cannot walk into. |
| Majoress | 420 | +0.60/s | Enormous and armoured, a 30-point bite. Pays you almost nothing. |

One rule matters more than the rest: **melee raiders run straight past defenders**, taking fire
the whole way. Only the Archer, Weaver, Exploder and Majoress will stop and shoot
back at a pad. A lane full of guns needs range sent into it, not more bodies.

**Defenders** sit on pads and never move. You get **four pads against three roads**,
which is the whole defensive game: you cannot cover everything, so decide which road
you are willing to leave open. Two pads flank the Short Road, one each the High and
the Low.

| | Cost | |
|---|---|---|
| Worker Post | 90 | Cheap pellets. Fills a gap. |
| Trap-Jaw Post | 150 | Short reach, snaps three at once, hard to kill. |
| Weaver Post | 190 | Slows a whole push so the rest of the line can work. |
| Mortar Post | 210 | Lobs into the column. Punishes stacked-up swarms. |
| Beacon | 230 | Buffs every pad in reach. Build it second, never first. |
| Archer Nest | 300 | Reaches into the next lane over. Paper-thin. |
| Honeypot | 260 | +7 sugar a second. Pays for itself in 38 seconds, if it lives. |

Sell anything back for 60%.

**Powers** cost sugar and have their own cooldown, and all three target a lane:

- **Rally** (140): your ants in that lane move 45% faster and hit 25% harder for six seconds.
- **Acid Rain** (190): 160 damage to every enemy ant standing in that lane.
- **Barricade** (160): a pebble wall in your half of that lane. They have to chew through it.

**Your queen** is one hero ant, picked before the match out of four, and she is the
only unit that does not walk into a nest. She advances to about three quarters of
the road and holds there, inside their pad line, killing what comes past. She costs
300 sugar the first time she walks out and nothing ever again: when she falls she is
gone for thirty seconds or more, then comes back with every level she earned.

She levels on kills she helped land, up to five. Levels make her bigger and harder,
and level 3 unlocks her ability, which is the real difference between the four:

| | | Ability, at level 3 |
|---|---|---|
| Warqueen | Heavy, armoured, walks at the front | **Onslaught**: for 6s every bite she lands craters the ground, and she charges |
| Silkqueen | Spins from the back rank, outranges a pad | **Snare**: every enemy near her is webbed to a crawl for 4s |
| Honeyqueen | Adds 4 sugar a second while she is alive | **Honeydew**: heals your ants near her and pays the colony 130 |
| Broodqueen | Fights at range, calls up bodies | **Levy**: four free workers boil out of the ground beside her |

You can call her onto a different road while she is out of a fight and has not yet
reached their gate. Past that she has to fight her way out of it.

**Scent trails** are the small thing to do between purchases. Marking a road costs 30
sugar and lays pheromone on it; your ants move faster along it, up to a quarter
faster at full strength. Your own traffic keeps a trail warm, but only to about a
third of the way: traffic holds a trail, marking builds one. Walk away from a road
and it goes cold in half a minute. Each colony's trail hugs its own edge of the road,
so you can always see whose is whose.

**Wildlife** wanders in every 55 seconds or so: a snail, a caterpillar, a pillbug.
Neither colony owns it, both can kill it, and whoever lands the most damage gets
150 to 300 sugar. It is worth breaking off a push for.

**Nothing lasts forever.** At 8:00 both nests start bleeding 2/second, so a match
between two turtles still ends. At 12:00 whoever has more nest left wins.

**The board remembers.** Roads darken where ants actually walked, so by the end you
can see at a glance which road each colony committed to, and debris and scorch stay
where the fighting and the nest bites happened. Pure decoration: it changes nothing
about how anything moves.

**Say something.** Six fixed emotes go over the socket mid-match and pop up over your
nest. It is a fixed list sent by index rather than a chat box, so there is no free
text to moderate and nothing a client can put on your screen that is not in the list.

**Colony colours.** Pick one of six before the match and it sticks between matches.
Not decoration either: both colonies field the same nine species, so the colour is
the only thing telling you whose ant you are looking at. If you and your opponent
pick the same one, they get the next one along. It reaches everything, including the
ants, the nests as they crumble, the HUD and the result card you send afterwards.

**Afterwards** you get a painted result card and a short share string to send
whoever you just played, and your record keeps wins, streaks, per-board tallies
and a head-to-head against each friend you name. All local, no account.

## The four boards

Ant Raid happens at ant scale, so a board is either the **forest floor** seen
from just above the litter, or a **cross-section of the soil** with the tunnels
cut open. Each one commits to an hour, and that decision drives the whole look:
which way every shadow falls, what drifts through the air, how much you can see.
Pick one on the title screen; online, the host picks and both players see it in
the lobby.

| Board | | |
|---|---|---|
| **Leaf Litter** | Open, surface | Late light through a canopy. Three trails worn through the leaf mould, nothing in the way. Two spoil heaps are high ground: build on one and that pad reaches 18% further. |
| **Rain Gully** | Tight, surface | A washed-out channel where every trail runs close, so splash damage is worth double. Standing water sits across the middle of each one. Ants wade. |
| **The Long Galleries** | Long, underground | Tunnels cut through old soil, wide outer runs and a serpentine middle. A seep floods the middle gallery, and wet clay is slow going. |
| **The Blind Deep** | Cruel, underground | Every tunnel squeezes through one junction in the middle. Glowing fungus lights the outer galleries only, so a pad in the dark sees 22% less, and the junction where it all happens is the part nobody can light. |

Boards differ in road shape more than anything else, which is what actually
changes how a match plays. The Blind Deep's High Road ends up in the same brawl
as everything else; the Galleries' outer runs are a 20-second walk.

The two worlds want opposite things from every painter, which is why
`js/scenery.js` switches on `world`: on the surface a road is a trail scraped
through litter down to damp earth and the light comes from a canopy; underground
a road is an excavated tunnel with mandible-bitten walls and there is no sun at
all. A nest is the same idea. Above ground it is a heap of excavated grain with a
crater bitten out of it and a shaft going down; below ground it is a chamber full
of brood with roots hanging into it. Neither is a coloured disc, which is what
the first version drew and it read as a coin.

## Controls

The rail down the left edge is three chips, one per road, stacked to match the
roads on the board. Each shows who is standing in that lane right now: your
colour growing from the left, theirs from the right. Pick a road there, then buy;
everything you buy goes down the road you have selected.

| | |
|---|---|
| `A` `S` `D` | Aim at the High, Short or Low Road |
| `1` to `5` | Send that raider down the aimed road |
| `Shift` + `1` to `5` | Build that defender on the free pad nearest the aimed road |
| `Q` `W` `E` | Rally, Acid Rain, Barricade |
| `R` | Lay a scent trail on the aimed road |
| `X` | Send your queen out, or call her onto the aimed road |
| `C` | Her ability, once she is level 3 |
| Click a pad | Build there, or sell what is on it |
| Click the board | Aim at the nearest road |
| `M` | Mute |
| `Esc` | Close the build menu |

In hot-seat the left HUD is keyboard-only and the right HUD is mouse-only, so two
people can share one screen without fighting over the same keys. Hot-seat needs a
keyboard, so it is a desktop mode.

On a phone the lane rail moves under the board, the shop scrolls sideways, and a
double tap on a road sends whatever you bought last down it, so you are not going
back to the shop strip for every push.

## What is going on underneath

The simulation is one file, [`shared/sim.js`](shared/sim.js), and it is plain ESM
with no DOM and no Node builtins. That is deliberate: **the server and the browser
run the same code**. Solo and hot-seat step it in the page; online matches step it
on the server and send snapshots, so a client can only ever ask for something and
be told no.

```
shared/          the game itself, runs in Node and the browser
  sim.js         30Hz simulation, the only thing that decides anything
  map.js         turns a map definition into a board, mirroring as it goes
  ai.js          the bot, which plays only through sim.command() like you do
  data/maps.js   the four boards: lanes, pads, features, props
  data/          unit stats and tuning. Balance lives here, never in the engine.
js/              the client: renderer, HUD, drivers, screens
  scenery.js     the two worlds: ground, roads, nests, props, light, weather
  record.js      the local record, the result card and the share string
  render/        ant and bug art, lifted from Grubs TD unchanged
server.js        static files + websocket rooms, one port
```

Online, the server ticks at 30Hz and broadcasts at 10Hz; the client renders 120ms
behind the newest snapshot so it always has two to interpolate between. Refreshing
mid-match rejoins the same colony rather than ending the match.

### Three things worth knowing

**The board is fair by construction.** Pads, mounds and hazards are authored once
for the left half and mirrored by `buildMap()`, so you cannot forget to mirror
them: you never write the right half. Lanes are the exception, because a lane
spans the whole board, so each one has to be its own mirror image (point *i*
mirrored equals point *n-1-i*). Get that wrong and one colony has a shorter walk
than the other, which is invisible by eye and quietly decides matches.
`npm run mapcheck` verifies every lane of every map, and so do the tests.
Decorative props are deliberately *not* mirrored: nothing reads them but the
painter, and a perfectly symmetrical picnic looks like wallpaper.

**A tick does not depend on array order.** Every unit picks its target from the same
frozen board before anything moves, and damage lands in a buffer applied at the end
of the tick. The first version resolved target-then-move per unit in array order,
which meant one team always stepped into range first and the other always landed the
opening blow. It won 6 matches out of 6 with its nest barely scratched.

**Never look up game content by truthiness.** `RAIDERS['__proto__']` returns
`Object.prototype`, which is truthy, so a `if (!def) reject` guard let a client
send `__proto__` as a unit: the cost check compared against `undefined` and passed,
making it free, and the sim then crashed on a type index of -1. Every lookup from
client input goes through `Object.hasOwn` now, and there is a test that fires the
whole family of inherited names at all three command handlers.

## Checking it still works

```bash
npm test
```

40 tests over fairness (on every map), economy, combat, map features, loadouts,
hostile input, the wire format and match endings. Then the harnesses, which need a running server for the last two:

```bash
npm run mapcheck
```

Audits every board: mirror error per lane, pad mirroring, whether a pad is
standing in a road it shouldn't be, whether the cheapest defender can even reach
the lane it is meant to cover, and an identical-script match per map that has to
end dead level.

```bash
npm run balance -- 8 normal normal all
```

Plays whole bot-vs-bot matches and reports win split, match length, breach rate and
what got bought. Pass a map id, or `all` to sweep every board. Current shape across
all four: 5.0 minute matches, 13% of raiders reach a nest, 1 in 32 goes to sudden
death, hard beats easy 16-4.

```bash
node tools/coop.js 8 normal all --probe
```

The same thing for co-op, which `balance.js` cannot see: two stand-in players
share colony 0 against the handicapped bot, and it reports how often the pair
win. `--probe` runs all three update orders and checks they agree before you
believe the split, `--sweep=2.4,2.8` tabulates the bot's income multiplier, and
`--seed` picks a different seed family, because one family leans several points
on its own. Current shape: 48% to the pair at `aiIncomeMul.coop` 2.8, which was
95% at the 1.7 the number sat on before anybody measured it.

```bash
npm run netcheck -- versus
```

Two real websocket clients play a whole match through the server and have to agree
on who won. `coop` for the other mode.

```bash
node tools/reconnect.js
```

Closes a client mid-match and brings it back.

```bash
node tools/snowball.js 10
```

Asks whether an early lead is already a win. The number that matters is the
comeback block: right now 97% of winners were behind at some point and 63% came
back from 20+ nest hp, which is what the eco taper and the leak refund are for.

In the browser, `window.AR` is the QA hook: `AR.solo()`, `AR.step(600)` to burst a
local match forward, `AR.paint()`, `AR.shot('name')` to write the board to `shots/`.
Handy because `requestAnimationFrame` is frozen in a hidden tab.

## Credits

The ants, the bugs, the sound bank and the type come from Grubs TD. Everything
else on the board is drawn here.

- Foley: [Kenney](https://kenney.nl) Impact Sounds, CC0. `assets/sfx/LICENSE-kenney-cc0.txt`
- Type: Baloo 2 by Ek Type, SIL Open Font License. `assets/fonts/OFL-Baloo2.txt`
- Everything else: MIT, see `LICENSE`.
