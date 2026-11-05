// Listening TCP ports of the programs in Herdr's terminals, on each machine, and
// the ssh tunnels (hc terminals labelled herdr.port-forward) that bring another
// machine's ports here.

import { exec, hc } from "herdr";

// Below this, a server someone started (3000, 5173, 8080); above it, the
// system's ephemeral range, where tools keep their internal sockets.
export const EPHEMERAL = 32768;
export const LABEL = "herdr.port-forward";

// "L pid port name" for each listening socket this user owns, then "P pid ppid" for each process.
const SCAN = String.raw`if command -v ss >/dev/null 2>&1; then ss -ltnpH 2>/dev/null | awk '{ n = split($4, a, ":"); if (match($0, /pid=[0-9]+/)) { pid = substr($0, RSTART + 4, RLENGTH - 4); name = ""; if (match($0, /\(\("[^"]*"/)) name = substr($0, RSTART + 3, RLENGTH - 4); print "L", pid, a[n], name } }'; else lsof -nP -iTCP -sTCP:LISTEN -Fpcn 2>/dev/null | awk '/^p/ { pid = substr($0, 2) } /^c/ { cmd = substr($0, 2) } /^n/ { n = split(substr($0, 2), a, ":"); print "L", pid, a[n], cmd }'; fi; ps -A -o pid= -o ppid= | awk '{ print "P", $1, $2 }'`;
// The first port from $1 up that nothing here listens on.
const FREE = String.raw`busy() { if command -v lsof >/dev/null 2>&1; then lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1; else ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; fi; }; p=$1; while busy "$p"; do p=$((p + 1)); done; echo "$p"`;

export async function listening(on) {
  const r = await exec("sh", ["-c", SCAN], { on });
  const listen = [], parent = new Map();
  for (const line of r.stdout.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f[0] === "L" && f.length >= 3) listen.push({ pid: Number(f[1]), port: Number(f[2]), name: f.slice(3).join(" ") });
    else if (f[0] === "P") parent.set(Number(f[1]), Number(f[2]));
  }
  return { listen, parent };
}

// The pid of what a terminal started, which every program in it descends from.
const pids = new Map();
export async function rootPid(address) {
  if (pids.has(address)) return pids.get(address);
  const r = await hc(["get", address, "--json"]);
  const pid = r.code === 0 ? JSON.parse(r.stdout).pid ?? null : null;
  if (pid) pids.set(address, pid);
  return pid;
}

let targets = null;
async function target(machine) {
  targets ??= JSON.parse((await hc(["machine", "ls", "--json"])).stdout).machines ?? [];
  return targets.find((m) => m.name === machine)?.target ?? machine;
}

// Live tunnels by "machine|port": the terminal running ssh and the port here.
export function tunnels(all) {
  const out = new Map();
  for (const t of all) {
    const v = t.state === "live" && t.labels?.[LABEL];
    if (!v) continue;
    const [machine, port, local] = v.split(":");
    out.set(`${machine}|${port}`, { address: t.address, local: Number(local) });
  }
  return out;
}

// machine's localhost:port as 127.0.0.1:<a free port> here, through ssh in a core terminal.
export async function forward(machine, port) {
  const f = await exec("sh", ["-c", FREE, "ports", String(port)]);
  const local = Number(f.stdout.trim()) || port;
  const name = `fwd-${machine}-${port}`.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 32);
  const r = await hc(["run", "--bg", "--json", "--no-parent", "--rm", "--name", name, "--label", `${LABEL}=${machine}:${port}:${local}`, "--",
    "ssh", "-N", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30",
    "-L", `127.0.0.1:${local}:localhost:${port}`, await target(machine)]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `Could not forward ${machine}:${port}`);
  return { address: JSON.parse(r.stdout).address, local };
}
