const https = require("https");

const sha = process.argv[2] || "aee8f8c";
const url = `https://github.com/imovi/bangladesh-universal-pos-management-system/commit/${sha}`;

https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
  let html = "";
  res.on("data", (c) => (html += c));
  res.on("end", () => {
    const passed = html.includes("All checks have passed") || html.includes("successful check");
    const failed = html.includes("checks failed") || html.includes("check failed");
    const pending = html.includes("Expected — Waiting for status") || html.includes("in progress");
    
    // Check specific octicons
    const hasCheck = html.includes("octicon-check");
    const hasX = html.includes("octicon-x");

    console.log(JSON.stringify({ passed, failed, pending, hasCheck, hasX }, null, 2));
  });
});
