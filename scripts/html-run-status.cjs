const https = require("https");

const runId = process.argv[2] || "44788339066";
const url = `https://github.com/imovi/bangladesh-universal-pos-management-system/actions/runs/${runId}`;

https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
  let html = "";
  res.on("data", (chunk) => (html += chunk));
  res.on("end", () => {
    const hasSuccessIcon = html.includes("color-fg-success");
    const hasFailIcon = html.includes("color-fg-danger");
    const hasInProgress = html.includes("anim-rotate") || html.includes("In progress");

    // Search for conclusion text
    const conclusionMatch = html.match(/(workflow run|Run) (completed|succeeded|failed|passed)/i);
    
    // Look for check run status in json script tags
    const jsonMatches = html.match(/"conclusion":"([^"]+)"/g);
    const statusMatches = html.match(/"status":"([^"]+)"/g);

    console.log(JSON.stringify({
      hasSuccessIcon,
      hasFailIcon,
      hasInProgress,
      conclusionMatch: conclusionMatch ? conclusionMatch[0] : null,
      conclusions: jsonMatches,
      statuses: statusMatches,
    }, null, 2));
  });
});
