# Getting a link you can actually send someone

Ant Raid needs a websocket that stays open, so it will not work on GitHub Pages
and it will not work on Vercel's default setup. It needs a host that runs a real
Node process. All the free ones below do.

The whole app is one process on one port. There is no build step, no database, and
nothing to configure except `PORT`, which the host sets for you.

## Before you deploy: play on your own network

If your friend is in the house, you do not need any of this.

```bash
npm run lan
```

That prints the address to send them and tells you whether the firewall will let
them in.

Windows does not always prompt. Inbound connections matching no rule are blocked
by default, and a blocked connection is silent: their browser hangs and your
server log stays empty, which looks exactly like a broken game. If `npm run lan`
says you are blocked, paste the line it gives you into a PowerShell started with
"Run as administrator". It opens one port, on Private networks only, and only to
machines on your own subnet:

```powershell
New-NetFirewallRule -DisplayName "Ant Raid (LAN)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5010 -Profile Private -RemoteAddress LocalSubnet
```

Undo it whenever you like:

```powershell
Remove-NetFirewallRule -DisplayName "Ant Raid (LAN)"
```

## Sending someone a link for one evening

One command, no account anywhere:

```bash
npm run share
```

That opens the tunnel, waits for the address, and starts the server behind it. It
also sets `AR_PUBLIC_URL`, which is the part that matters: without it you browse
`http://localhost`, the lobby copies a `localhost` link, and your friend gets
nothing. With it, the lobby hands out the tunnel address whichever of the two you
have open.

The long way round, if you want the two halves in separate terminals:

```bash
npx cloudflared tunnel --url http://localhost:5010
```

```bash
AR_PUBLIC_URL=https://something-random.trycloudflare.com npm start
```

Either way the link works from anywhere, it dies when you close the terminal, and
your PC has to stay on. Good for a one-off, annoying if you want to play again
next week.

## Putting it somewhere that stays up

### Render

The free tier sleeps after 15 minutes idle and takes about 50 seconds to wake, so
the first player to arrive waits. After that it is fine.

1. Push this folder to GitHub.
2. On [render.com](https://render.com): **New → Web Service**, point it at the repo.
3. Runtime **Node**, build `npm install`, start `npm start`.
4. Leave the port alone: the server reads `PORT` from the environment.

Websockets work on the free tier with no extra setup.

### Railway

No sleeping, but the free allowance is a monthly credit rather than unlimited.

```bash
npm i -g @railway/cli
railway login
railway init
railway up
```

Then **Settings → Generate Domain**.

### Fly.io

Closest to the player, which matters least here, since the server only sends 10
snapshots a second. Worth it if you and your friend are far apart.

```bash
fly launch --no-deploy
```

Then set `internal_port = 5010` in the generated `fly.toml`, or delete the `PORT`
line and let it use `8080`, and:

```bash
fly deploy
```

## Checking a deploy actually works

`GET /health` returns `ok`, which is what the hosts poll.

Point the network check at the deployed server and it will create a room, join it,
play a whole match and assert both clients agree:

```bash
AR_URL=wss://your-app.onrender.com/ws node tools/netcheck.js versus
```

That takes a few minutes because the match runs in real time. If it gets as far as
`both clients started`, the websocket is working and the rest is just the game.

## If it breaks

**The room code says "no room called ABCD".** Rooms live in memory, so a restart
loses them. Free hosts restart on deploy and after idling. Make a new room.

**One player connects and the other cannot.** Almost always a host that terminates
websockets. Check the host's docs for websocket support rather than the app.

**It works locally over `http` but not deployed over `https`.** The client picks
`ws://` or `wss://` from `location.protocol`, so this should not happen. If you
put it behind a proxy, make sure the proxy forwards `Upgrade` and `Connection`
headers.

**Empty rooms hang around.** They do not: a room with nobody in it is swept after
10 minutes, and a colony that stays empty for 45 seconds during a match forfeits.
