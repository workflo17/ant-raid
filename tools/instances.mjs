// ===== Who else is running Ant Raid on this machine =====
//
// Two worktrees, two terminals, a dev server and a netcheck: they all want port
// 5010 and only one of them can have it. This is how a second instance finds
// out the first exists, instead of dying on EADDRINUSE with no idea what took
// the port, and how a tool finds a server that had to move.
//
// It lives in the OS temp directory and NOT in the repo, because that is the
// whole point: separate worktrees have separate repo roots and would each write
// a registry the other could never see. Temp is the one location every instance
// on the box agrees on.
//
// A CONVENIENCE, NEVER A DEPENDENCY. Every read is allowed to come back empty
// and every write is allowed to fail. The server picks its port by trying to
// bind it, not by consulting this file, so a stale, missing, unwritable or
// clobbered registry costs you a console line and nothing else.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REGISTRY = path.join(os.tmpdir(), 'ant-raid-instances.json');

/**
 * Ask the OS whether a pid is still there. Signal 0 runs every permission check
 * and delivers nothing, which is the standard way to test liveness.
 *
 * Liveness has to be decided this way rather than by trusting the file, because
 * a server that is killed hard, crashes, or is stopped by a runner never gets
 * to deregister. Anything else leaves phantom entries forever.
 */
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Everything currently running, dead entries dropped. */
export function listInstances() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  return raw.filter((e) => e && Number.isInteger(e.pid) && Number.isInteger(e.port) && alive(e.pid));
}

/**
 * Write through a temp file and rename.
 *
 * Two servers starting in the same instant can still lose one entry, since this
 * is read-modify-write with no lock, and that is accepted: the cost is one
 * missing line of "also running" output. What a rename prevents is the failure
 * that would actually matter, a half-written file that parses as nothing and
 * blanks the registry for everybody.
 */
function write(list) {
  const tmp = `${REGISTRY}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
    fs.renameSync(tmp, REGISTRY);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* nothing left to clean up */ }
  }
}

/** Register this process, and return everyone else who is up. */
export function claim(entry) {
  const others = listInstances().filter((e) => e.pid !== entry.pid);
  write([...others, entry]);
  return others;
}

export function release(pid) {
  write(listInstances().filter((e) => e.pid !== pid));
}
