const https = require("https");
const runId = process.argv[2] || "44791372247";
const url = `https://github.com/imovi/bangladesh-universal-pos-management-system/actions/runs/${runId}`;

https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
  let html = "";
  res.on("data", (chunk) => (html += chunk));
  res.on("end", () => {
    const successIcons = (html.match(/octicon-check-circle-fill/g) || []).length;
    const dangerIcons = (html.match(/octicon-x-circle-fill/g) || []).length;
    const inProgress = (html.match(/octicon-dot-fill/g) || []).length;
    console.log({ runId, successIcons, dangerIcons, inProgress });
  });
});
