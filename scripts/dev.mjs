import { spawn } from "node:child_process";

const children = [];
const API_HEALTH_URL = "http://localhost:3000/api/health";

function run(label, script) {
  const child =
    process.platform === "win32"
      ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npm.cmd run ${script}`], {
          stdio: "inherit"
        })
      : spawn("npm", ["run", script], {
          stdio: "inherit"
        });

  child.on("exit", (code, signal) => {
    if (signal || code) {
      shutdown(typeof code === "number" ? code : 1);
      return;
    }
  });

  child.on("error", (error) => {
    console.error(`[${label}] failed to start:`, error.message);
    shutdown(1);
  });

  children.push(child);
}

async function canReuseExistingServer() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);

  try {
    const response = await fetch(API_HEALTH_URL, {
      signal: controller.signal
    });

    if (!response.ok) {
      return false;
    }

    const payload = await response.json().catch(() => null);
    return payload?.server === "online";
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function shutdown(exitCode = 0) {
  while (children.length > 0) {
    const child = children.pop();
    if (child && !child.killed) {
      child.kill();
    }
  }

  process.exit(exitCode);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("web", "dev:web");

if (await canReuseExistingServer()) {
  console.log("[server] Reusing existing API server on http://localhost:3000");
} else {
  run("server", "dev:server");
}
