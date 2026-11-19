const { execSync } = require('child_process');

try {
  const html = execSync('curl.exe -sL https://github.com/imovi/bangladesh-universal-pos-management-system/actions', { maxBuffer: 10 * 1024 * 1024 }).toString();
  const marker = '<script type="application/json" data-target="react-app.embeddedData">';
  const idx = html.indexOf(marker);
  if (idx !== -1) {
    const endIdx = html.indexOf('</script>', idx);
    const jsonStr = html.substring(idx + marker.length, endIdx);
    const data = JSON.parse(jsonStr);
    const runs = data.payload?.allWorkflowRunsRoute?.workflowRuns;
    if (runs && runs.length > 0) {
      const top3 = runs.slice(0, 3).map(r => ({
        id: r.id,
        head_sha: r.description?.linkText,
        title: r.title,
        status: r.state?.status,
        conclusion: r.state?.conclusion || null,
        url: r.runUrl,
      }));
      console.log(JSON.stringify(top3, null, 2));
    } else {
      console.log('No runs found in payload');
    }
  } else {
    console.log('Embedded data marker not found');
  }
} catch (err) {
  console.error(err.message);
}
