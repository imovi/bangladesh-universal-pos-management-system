const https = require("https");
const jobId = process.argv[2] || "136479601166";
const url = `https://github.com/imovi/bangladesh-universal-pos-management-system/actions/runs/44791372247/job/${jobId}`;

https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
  let html = "";
  res.on("data", (chunk) => (html += chunk));
  res.on("end", () => {
    const errorSnippet = html.match(/Process completed with exit code \d+/g);
    console.log("Exit code snippets:", errorSnippet);

    const matches = html.match(/aria-label="[^"]+"/g) || [];
    console.log("Aria labels:", matches.filter(m => m.includes("completed") || m.includes("succeeded") || m.includes("failed") || m.includes("progress") || m.includes("queued")));
  });
});
