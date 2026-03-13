# Deploy on Vercel

The **Next.js app (phase5)** can be deployed on Vercel. The full "Generate one-pager" pipeline (Python) does **not** run on Vercel; use **"Run weekly pulse in cloud"** to trigger the GitHub Actions workflow instead. You'll receive the email when the workflow finishes.

## Steps

1. **Push your repo to GitHub** (if not already).

2. **In Vercel:** [vercel.com/new](https://vercel.com/new) → Import your Git repository.

3. **Set the Root Directory:** In the project settings (or during import), set **Root Directory** to `phase5`. (Leave "Framework Preset" as Next.js.)

4. **Environment variables (optional for trigger):**  
   To enable **"Run weekly pulse in cloud"** on the deployed site, add in Vercel → Project → Settings → Environment Variables:
   - `GITHUB_TOKEN` — A [GitHub Personal Access Token](https://github.com/settings/tokens) with `repo` scope (or at least `workflow` for triggering actions).
   - `GITHUB_REPO` — Your repo in the form `owner/repo`, e.g. `Vaishnavishantharam/indmoney_reviewbot`.

5. **Deploy.** The UI will be live. "Generate one-pager" will show a message to use the cloud button; "Run weekly pulse in cloud" will start the workflow (if the env vars are set).

## Notes

- **Generate one-pager** (instant, in-browser) only works when you run the app **locally** (or on a server with Python and the full repo). On Vercel it returns a short message and suggests using the cloud button.
- **Run weekly pulse in cloud** triggers the same workflow that runs on schedule (Sunday 9:45 PM CST). Ensure [GitHub Actions secrets](https://github.com/Vaishnavishantharam/indmoney_reviewbot/settings/secrets/actions) are set: `GROQ_API_KEY`, `GEMINI_API_KEY`, `EMAIL_SENDER`, `EMAIL_PASSWORD`.
