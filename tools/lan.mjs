// Play over your own wifi: same house, no tunnel, no internet round trip.
//
//   npm run lan
//
// Prints the address to send whoever is on the couch, tells you whether Windows
// will actually let them through, and then starts the game.
//
// The server already listens on every interface, so the address is never the
// problem. On Windows the firewall is: inbound connections that match no rule
// are blocked by default, so a friend's browser hangs with no error and nothing
// appears in the server log. That silence is why this command checks first and
// says so, rather than leaving you to guess.

import { execFileSync } from 'node:child_process';
import os from 'node:os';
import process from 'node:process';

const PORT = Number(process.env.PORT || 5010);
const RULE = 'Ant Raid (LAN)';

/** Every address a friend on this network could actually reach. */
export function lanAddresses(nets = os.networkInterfaces()) {
  const out = [];
  for (const [name, addrs] of Object.entries(nets)) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      // 169.254.x is a self-assigned address: the machine failed to get one
      if (a.address.startsWith('169.254.')) continue;
      out.push({ name, address: a.address });
    }
  }
  return out;
}

/**
 * Is there an inbound rule that would let a friend reach this game?
 *
 * Two things count, and NOTHING else does:
 *   - the rule this tool tells you to make, by name
 *   - a rule scoped to a node.exe program, which is what Windows creates when
 *     you click "Allow access" on its popup
 *
 * Matching on the port alone is wrong and I had it wrong first: plenty of
 * inbound Allow rules carry `LocalPort = Any` while being scoped to some
 * unrelated program, so a port check reported 5010, 5011 and even a random
 * unused 49999 as open. Any-port does not mean any-program.
 *
 * Best effort and never fatal: a wrong answer here costs a printed warning, not
 * the ability to start the game.
 */
export function firewallAllows(port) {
  if (process.platform !== 'win32') return null;   // nothing to say
  // Two bulk queries, not one COM call per rule. Walking every rule and piping
  // each to Get-NetFirewallApplicationFilter took over 40 seconds on a normal
  // Windows install, which is far too long to sit in front of `npm run lan`.
  const ps = `
    $named = @(Get-NetFirewallRule -DisplayName '${RULE}' -ErrorAction SilentlyContinue |
      Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }).Count -gt 0
    $byProgram = $false
    if (-not $named) {
      $hits = @(Get-NetFirewallApplicationFilter -All -ErrorAction SilentlyContinue |
        Where-Object { $_.Program -like '*node.exe' })
      foreach ($h in $hits) {
        $r = $h | Get-NetFirewallRule -ErrorAction SilentlyContinue
        if ($r -and $r.Enabled -eq 'True' -and $r.Direction -eq 'Inbound' -and $r.Action -eq 'Allow') { $byProgram = $true; break }
      }
    }
    if ($named -or $byProgram) { 'yes' } else { 'no' }`;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], {
      encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out.endsWith('yes');
  } catch {
    return null;   // could not tell, say so rather than lie
  }
}

if (process.argv[1]?.endsWith('lan.mjs')) main();

async function main() {
  const addrs = lanAddresses();
  console.log('');
  if (!addrs.length) {
    console.log('This machine has no network address, so nobody can reach it.');
    console.log('Connect to your wifi and run this again.\n');
  } else {
    console.log('Send whoever is on your wifi one of these:\n');
    for (const a of addrs) console.log(`    http://${a.address}:${PORT}      (${a.name})`);
    console.log('');
  }

  const allowed = firewallAllows(PORT);
  if (allowed === false) {
    console.log('Windows Firewall will block them right now. Their browser will just hang,');
    console.log('and nothing will appear in this log, so it looks like the game is broken.');
    console.log('\nOpen one door, once. In PowerShell started with "Run as administrator",');
    console.log('paste this ONE line:\n');
    // deliberately unwrapped: a line continuation is the easiest thing to break
    // on the way through a chat window or a paste into the wrong shell
    console.log(`    New-NetFirewallRule -DisplayName "${RULE}" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${PORT} -Profile Private -RemoteAddress LocalSubnet\n`);
    console.log(`It opens port ${PORT} only, on networks marked Private only, and only to`);
    console.log('machines on your own subnet. To take it away again:\n');
    console.log(`    Remove-NetFirewallRule -DisplayName "${RULE}"\n`);
  } else if (allowed === true) {
    console.log('Windows Firewall already allows this port. They should get straight in.\n');
  } else if (process.platform === 'win32') {
    console.log('Could not read the firewall rules. If your friend cannot connect, that is');
    console.log('the first thing to check.\n');
  }

  console.log('Starting the game. Ctrl+C to stop.\n');
  // Pin the port before handing server.js the process. It slides to the next
  // free one when PORT is unset, which would be wrong here: every address
  // printed above names this port, and a server that quietly moved would send
  // whoever is on the couch to a port with nothing on it. Better to fail with
  // EADDRINUSE, which at least says what happened.
  process.env.PORT = String(PORT);
  await import('../server.js');
}
