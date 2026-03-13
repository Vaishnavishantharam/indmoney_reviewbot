/**
 * Trigger the Weekly Pulse GitHub Actions workflow (workflow_dispatch).
 * Used when the app is deployed on Vercel where the full Python pipeline cannot run.
 * Set in Vercel: GITHUB_TOKEN (PAT with repo scope), GITHUB_REPO (e.g. owner/repo).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) {
    return Response.json(
      {
        error:
          "Trigger not configured. Set GITHUB_TOKEN and GITHUB_REPO in Vercel environment variables.",
      },
      { status: 503 }
    );
  }
  const [owner, repoName] = repo.split("/").filter(Boolean);
  if (!owner || !repoName) {
    return Response.json(
      { error: "GITHUB_REPO must be owner/repo (e.g. Vaishnavishantharam/indmoney_reviewbot)" },
      { status: 400 }
    );
  }
  const workflowId = "weekly-pulse.yml";
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${workflowId}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main" }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      return Response.json(
        { error: `GitHub API error: ${res.status} ${text}` },
        { status: 502 }
      );
    }
    return Response.json({
      ok: true,
      message: "Weekly pulse pipeline started. You'll receive the email when it finishes (usually within a few minutes).",
    });
  } catch (e) {
    return Response.json(
      { error: e.message || "Failed to trigger workflow" },
      { status: 500 }
    );
  }
}
