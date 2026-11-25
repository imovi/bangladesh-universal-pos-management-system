const https = require("https");

function printAuthStatus() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token && token.trim()) {
    process.stderr.write("GitHub API: authenticated\n");
  } else {
    process.stderr.write("GitHub API: anonymous (60 requests/hour)\n");
  }
}

function githubGet(apiPath) {
  return new Promise((resolve, reject) => {
    let cleanPath = apiPath;
    if (cleanPath.startsWith("https://api.github.com")) {
      cleanPath = cleanPath.slice("https://api.github.com".length);
    }
    if (!cleanPath.startsWith("/")) {
      cleanPath = "/" + cleanPath;
    }

    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const headers = {
      "User-Agent": "UniversalPOS-CI-Scripts",
      "Accept": "application/vnd.github+json",
    };

    if (token && token.trim()) {
      headers["Authorization"] = `Bearer ${token.trim()}`;
    }

    const options = {
      hostname: "api.github.com",
      port: 443,
      path: cleanPath,
      method: "GET",
      headers,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode === 401) {
          console.error("GitHub token rejected (401). Check GITHUB_TOKEN.");
          process.exit(1);
        }

        const remaining = res.headers["x-ratelimit-remaining"];
        const reset = res.headers["x-ratelimit-reset"];

        let json;
        try {
          json = JSON.parse(data);
        } catch {
          if (res.statusCode === 403 || res.statusCode === 429) {
            return resolve({
              rateLimited: true,
              reset: reset || "unknown",
              message: "API rate limit exceeded",
            });
          }
          console.error("Failed to parse API response JSON");
          process.exit(1);
        }

        if (
          (res.statusCode === 403 || res.statusCode === 429) &&
          (remaining === "0" || remaining === 0 || (json && json.message && json.message.includes("API rate limit exceeded")))
        ) {
          return resolve({
            rateLimited: true,
            reset: reset || "unknown",
            message: json.message || "API rate limit exceeded",
            ...json,
          });
        }

        resolve(json);
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.end();
  });
}

module.exports = {
  githubGet,
  printAuthStatus,
};
