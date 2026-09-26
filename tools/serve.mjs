// Tiny static file server for docs/ (no dependencies), for previewing the app in a browser.
// Alt1 itself won't install apps from a local http address - use the GitHub Pages link for that.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "docs");
const port = +(process.argv[2] || process.env.PORT || 7280);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".map": "application/json" };

function log(req, status) {
	const t = new Date().toTimeString().slice(0, 8);
	const agent = /alt1/i.test(req.headers["user-agent"] || "") ? " [Alt1]" : "";
	console.log(`${t}  ${status}  ${req.method} ${req.url}${agent}`);
}

function handler(req, res) {
	const url = decodeURIComponent((req.url || "/").split("?")[0]);
	let file = path.join(root, url == "/" ? "index.html" : url);
	if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
		log(req, 404);
		res.writeHead(404); res.end("not found"); return;
	}
	// Send whole files with a Content-Length instead of streaming (chunked). Alt1's installer
	// downloaded a streamed appconfig.json and then silently did nothing.
	const body = fs.readFileSync(file);
	log(req, 200);
	res.writeHead(200, {
		"Content-Type": types[path.extname(file)] || "application/octet-stream",
		"Content-Length": body.length,
		"Cache-Control": "no-cache",
		"Access-Control-Allow-Origin": "*",
	});
	res.end(body);
}

// Listen on both IPv4 and IPv6 loopback: on Windows "localhost" usually resolves to ::1 first,
// so an IPv4-only server looks like it isn't running to Alt1. Still only reachable from this PC.
let listening = 0;
for (const host of ["127.0.0.1", "::1"]) {
	const srv = http.createServer(handler);
	srv.on("error", e => {
		if (e.code == "EADDRINUSE") { console.log(`Port ${port} is already in use on ${host} - is another copy of start.bat already running?`); }
		else if (host == "::1") { /* no IPv6 on this machine, IPv4 is enough */ }
		else { console.log(`Could not start server on ${host}: ${e.message}`); }
	});
	srv.listen(port, host, () => {
		if (listening++ > 0) { return; }
		console.log(`Nexus Tracker is being served at http://localhost:${port}/`);
		console.log(`Open http://localhost:${port}/?demo to see it with sample data.\n`);
		console.log("Leave this window open while you use the app. Ctrl+C to stop.");
	});
}
