// Mondo desktop window. Electron is only a shell: it makes sure the Next.js server is
// running (starting it if nothing answers on the configured port), then loads it.
const { app, BrowserWindow, shell } = require("electron");
const { spawn, execFile, execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dev = process.argv.includes("--dev");

function serverAddress() {
  let server = { host: "127.0.0.1", port: 4317 };
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, "mondo.config.json"), "utf8"));
    server = { ...server, ...(cfg.server || {}) };
  } catch {
    /* defaults */
  }
  const host = process.env.MONDO_HOST || server.host;
  const port = Number(process.env.MONDO_PORT || server.port);
  // A wildcard bind isn't something a browser can load; use loopback for the window.
  const connectHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return { url: `http://${connectHost}:${port}`, host, port };
}

/** "mondo" if Mondo answers, "other" if something else holds the port, "none" if nothing does. */
function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/health`, { timeout: 1500 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body).app === "mondoshawan" ? "mondo" : "other");
        } catch {
          resolve("other");
        }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", (err) => resolve(err.code === "ECONNREFUSED" ? "none" : "other"));
  });
}

let serverProc = null;

function startServer() {
  const args = [path.join(root, "scripts", "serve.mjs")];
  if (dev) args.push("--dev");
  // Run the launcher with Electron's bundled Node, so no separate Node install is needed.
  serverProc = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
    windowsHide: true,
  });
  serverProc.on("exit", (code) => {
    console.log(`[mondo] server exited (${code})`);
    serverProc = null;
  });
}

function stopServer() {
  if (!serverProc) return;
  const pid = serverProc.pid;
  serverProc = null;
  if (process.platform === "win32") {
    // Kill the whole tree (launcher + next + workers); a plain kill would orphan next.
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

/** Identifies the code a build was made from: git HEAD plus any uncommitted changes. */
function sourceStamp() {
  try {
    const git = (args) => execFileSync("git", ["-C", root, ...args], { windowsHide: true }).toString();
    const status = git(["status", "--porcelain", "--", ".", ":(exclude)data"]);
    return git(["rev-parse", "HEAD"]).trim() + ":" + crypto.createHash("sha1").update(status).digest("hex");
  } catch {
    return null; // not a git checkout: only build when there's no build at all
  }
}

/**
 * Production mode needs `next build`. Rebuild when there's no build yet, or the code
 * changed since the last one (so the desktop shortcut always runs current code).
 */
async function ensureBuild(win) {
  const stampFile = path.join(root, ".next", "mondo-build-stamp");
  const hasBuild = fs.existsSync(path.join(root, ".next", "BUILD_ID"));
  const stamp = sourceStamp();
  let built = null;
  try {
    built = fs.readFileSync(stampFile, "utf8");
  } catch {
    /* no stamp yet */
  }
  if (hasBuild && (stamp === null || stamp === built)) return true;

  win.loadURL(statusPage("Updating Mondo… (building, this takes about a minute)"));
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [nextBin, "build"], {
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_OPTIONS: [process.env.NODE_OPTIONS, "--disable-warning=ExperimentalWarning"].filter(Boolean).join(" "),
      },
      stdio: "inherit",
      windowsHide: true,
    });
    p.on("exit", resolve);
    p.on("error", () => resolve(1));
  });
  if (code !== 0) {
    win.loadURL(statusPage("Mondo couldn't build. Run <code>npm run build</code> in the Mondo folder to see why."));
    return false;
  }
  if (stamp) fs.writeFileSync(stampFile, stamp);
  return true;
}

const statusPage = (msg) =>
  "data:text/html;charset=utf-8," +
  encodeURIComponent(
    `<html><body style="font:15px system-ui;background:#111317;color:#e6e8eb;display:grid;place-items:center;height:100vh;margin:0">
     <div>${msg}</div></body></html>`,
  );

async function createWindow() {
  const { url } = serverAddress();
  const win = new BrowserWindow({
    width: 1150,
    height: 720,
    title: "Mondo",
    backgroundColor: "#111317",
    icon: path.join(root, "assets", "mondo.ico"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });

  let state = await probe(url);
  if (state === "other") {
    win.loadURL(statusPage(`Something else is using ${url}. Change the port in mondo.config.json.`));
    return;
  }
  if (state === "none") {
    if (!dev && !(await ensureBuild(win))) return;
    win.loadURL(statusPage("Starting Mondo…"));
    startServer();
    const deadline = Date.now() + 120_000;
    while (state !== "mondo" && Date.now() < deadline && serverProc) {
      await new Promise((r) => setTimeout(r, 500));
      state = await probe(url);
    }
    if (state !== "mondo") {
      win.loadURL(
        statusPage(
          dev
            ? "Mondo's server didn't start. Check the terminal for errors."
            : "Mondo's server didn't start. Did you run <code>npm run build</code>? (Or use <code>npm run dev</code>.)",
        ),
      );
      return;
    }
  }
  win.loadURL(url);
}

// Own taskbar identity (matches the desktop shortcut), so Mondo doesn't group as "Electron".
app.setAppUserModelId("Mondoshawan.Mondo");
app.setName("Mondo");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(createWindow);
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", stopServer);
  process.on("exit", stopServer);
}
