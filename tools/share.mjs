// Start Ant Raid on a public address, so the link in the lobby is one you can
// actually send someone.
//
//   npm run share
//
// It opens a Cloudflare quick tunnel (no account, no signup), waits for the
// address it hands back, and then starts the server with AR_PUBLIC_URL set to
// it. That last part is the whole point: without it the host browses
// http://localhost, the lobby copies a localhost link, and the friend gets
// nothing. With it, the lobby hands out the tunnel address no matter which of
// the two you happen to have open.
//
// The tunnel is temporary and public. It lives as long as this command runs,
// it dies when you press Ctrl+C, and your machine has to stay awake. For
// something that stays up on its own, deploy it once: see DEPLOY.md.

import { spawn, execSync } from 'node:child_process';
import net from 'node:net';
import process from 'node:process';

const PORT = Number(process.env.PORT || 5010);
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
// cloudflared prints its address to stderr, and not always on its own line
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/**
 * Is this port ours to publish?
 *
 * CHECK BEFORE OPENING ANYTHING. The first version opened the tunnel first and
 * started the server second. When the port was already taken by an unrelated
 * server, the tunnel came up anyway and published SOMEBODY ELSE'S process to
 * the internet while ours died with EADDRINUSE.
 *
 * Bind exactly the way server.js does — `listen(port)` with no host, which is
 * the dual-stack `::`. Probing `0.0.0.0` instead is not the same socket: on
 * Windows it bound happily while another process already held `:::5010`, the
 * check passed, and a tunnel went up in front of that other process anyway.
 */
function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port);
  });
}

/**
 * Kill a child AND everything it spawned.
 *
 * On Windows npx has to run through a shell, so `child.kill()` kills the shell
 * and leaves cloudflared.exe running: the tunnel stays up after this command
 * exits, which is the worst possible failure for something that publishes your
 * machine. taskkill /T takes the whole tree.
 */
function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); return; } catch { /* fall through */ }
  }
  try { child.kill(); } catch { /* already gone */ }
}

/** Pull the tunnel address out of whatever cloudflared has printed so far. */
export function findTunnelUrl(text) {
  const m = String(text).match(URL_RE);
  return m ? m[0] : null;
}

// Exported above so tools can be tested without opening a tunnel; running the
// file is what actually opens one.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('share.mjs')) {
  main();
}

async function main() {
  // Nothing is published until we know the port is ours to publish.
  if (!(await portIsFree(PORT))) {
    console.error(`Port ${PORT} is already in use, so this would publish whatever is on it.`);
    console.error('Stop that server first, or pick a port nothing else is using:\n');
    console.error('    PORT=5011 npm run share\n');
    process.exit(1);
  }

  console.log(`Opening a public tunnel to localhost:${PORT}…`);
  console.log('This exposes the game on the internet for as long as this command runs.\n');

  const tunnel = spawn(NPX, ['-y', 'cloudflared', 'tunnel', '--url', `http://localhost:${PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  let server = null;
  let found = null;
  let buffered = '';

  const watch = (chunk) => {
    const text = String(chunk);
    if (found) return;
    // the address can be split across two writes, so match against the tail
    buffered = (buffered + text).slice(-4000);
    const url = findTunnelUrl(buffered);
    if (!url) return;
    found = url;
    startServer(url);
  };

  tunnel.stdout.on('data', watch);
  tunnel.stderr.on('data', watch);

  tunnel.on('error', (e) => {
    console.error(`\nCould not start cloudflared: ${e.message}`);
    console.error('It is downloaded on first use, so this needs a working npx and network.');
    console.error('The game still runs locally with: npm start');
    process.exit(1);
  });

  tunnel.on('exit', (code) => {
    if (!found) {
      console.error(`\ncloudflared exited (${code}) before giving out an address.`);
      console.error('The game still runs locally with: npm start');
    }
    killTree(server);
    process.exit(code ?? 0);
  });

  function startServer(url) {
    console.log(`\n  Send your friend this:  ${url}`);
    console.log(`  Open the same address yourself, and the room link will be shareable too.\n`);
    server = spawn(process.execPath, ['server.js'], {
      stdio: 'inherit',
      // PORT is passed EXPLICITLY, and that is load-bearing rather than tidy.
      // server.js slides to the next free port when PORT is unset, which is
      // right on a dev box and catastrophic here: the tunnel is already open on
      // this port, so a server that quietly moved would leave a live public
      // address pointing at whatever else is sitting on it. Setting PORT pins
      // it, so if the port went in the gap since the check above, the server
      // dies loudly and takes the tunnel down with it.
      env: { ...process.env, AR_PUBLIC_URL: url, PORT: String(PORT) },
    });
    // if the game dies, the tunnel dies with it: a live public address left
    // pointing at whatever grabs the port next is the worst outcome here
    server.on('exit', (code) => {
      console.log('\nGame stopped. Closing the tunnel.');
      killTree(tunnel);
      process.exit(code ?? 0);
    });
  }

  const shutDown = () => { killTree(tunnel); killTree(server); process.exit(0); };
  process.on('SIGINT', shutDown);
  process.on('SIGTERM', shutDown);
  process.on('exit', () => { killTree(tunnel); killTree(server); });
}
