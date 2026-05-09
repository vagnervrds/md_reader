let proc = null;

function setProcess(p) {
  proc = p;
}

function send(msg) {
  if (proc && !proc.killed) {
    try { proc.send(msg); } catch (e) { /* noop */ }
  }
}

module.exports = { setProcess, send };
