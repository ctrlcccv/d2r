import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "web");
const SHARED_PRICING = path.join(ROOT, "src", "lib", "pricing.mjs");
const PORT = Number(process.env.PORT || 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let filePath;

  if (url.pathname === "/shared/pricing.mjs") {
    filePath = SHARED_PRICING;
  } else {
    filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);
  }

  if (!filePath.startsWith(PUBLIC_DIR) && filePath !== SHARED_PRICING) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream"
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Open http://localhost:${PORT}`);
});
