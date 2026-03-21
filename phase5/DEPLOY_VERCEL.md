# Deploy on Vercel

The **Next.js app (phase5)** can be deployed on Vercel.

---

## Option A: Backend on Streamlit + API, Frontend on Vercel (recommended)

This avoids running the heavy pipeline (and Gemini) on Vercel serverless. **Backend** runs the Python pipeline (Streamlit UI + Flask API). **Frontend** on Vercel calls the backend API for "Generate one-pager".

### 1. Deploy the backend (Python API)

Deploy the **Flask API** so the pipeline runs there:

- **Railway (Docker, recommended):** New Project → Deploy from GitHub → select this repo. Railway will detect the **Dockerfile** at the repo root and build/run the backend. Add env vars: `GROQ_API_KEY`, `GEMINI_API_KEY`. Optional: `CORS_ORIGINS` = your Vercel URL. See [DEPLOY_RAILWAY.md](../DEPLOY_RAILWAY.md) in the repo root for steps.
- **Render:** New Web Service → connect repo. **Build:** `pip install -r requirements.txt`. **Start:** `python api_server.py`. Add env: `GROQ_API_KEY`, `GEMINI_API_KEY`.

Note the backend URL (e.g. `https://your-app.railway.app` or `https://your-app.onrender.com`).

### 2. Deploy the Streamlit app (optional)

For a standalone UI to run the pipeline in the browser:

- Go to [share.streamlit.io](https://share.streamlit.io) → New app → connect this repo.
- **Main file path:** `streamlit_app.py`. **App URL:** e.g. `https://your-app.streamlit.app`.
- In Streamlit Cloud → Settings → Secrets, add: `GROQ_API_KEY`, `GEMINI_API_KEY`. Optional: `APP_ID`, `WEEKS_BACK`.

### 3. Deploy the frontend on Vercel

1. [vercel.com/new](https://vercel.com/new) → Import your repo.
2. Set **Root Directory** to `phase5`.
3. **Environment variables:**

   | Variable | Required | Description |
   |----------|----------|-------------|
   | `NEXT_PUBLIC_BACKEND_URL` | Yes (for Generate) | Backend API URL, e.g. `https://your-app.railway.app` (no trailing slash). When set, the UI calls **`/api/proxy-weekly-pulse`** so the browser never hits Railway directly (CORS). Response includes **`pulseBundle`**, **`feeBlockMarkdown`**, **`feeBlockPlain`** if the backend is up to date. |
   | `EMAIL_SENDER` | For Send email | Your sending email |
   | `EMAIL_PASSWORD` | For Send email | Gmail app password or SMTP password |
   | `SMTP_HOST`, `SMTP_PORT` | Optional | Defaults: Gmail |
   | `GITHUB_TOKEN`, `GITHUB_REPO` | Optional | For "Run weekly pulse in cloud" |

4. Deploy. **Generate one-pager** will call your backend API. **Send email** still uses Vercel serverless (or use "Run weekly pulse in cloud" to get the email from GitHub Actions).

---

## Option B: All on Vercel (no separate backend)

**Generate one-pager** runs a **Node.js** pipeline on Vercel (fetch reviews → Groq → Gemini). The app uses **Gemini 2.5 Flash** (or 2.0 Flash fallback); older model IDs like `gemini-1.5-flash-001` are no longer supported and have been removed.

### Steps

1. **Push your repo to GitHub** (if not already).

2. **In Vercel:** [vercel.com/new](https://vercel.com/new) → Import your Git repository.

3. **Set the Root Directory** to `phase5`.

4. **Environment variables** (Vercel → Project → Settings → Environment Variables):

   | Variable | Required | Description |
   |----------|----------|-------------|
   | `GROQ_API_KEY` | Yes | For theme discovery and classification ([console.groq.com](https://console.groq.com/keys)) |
   | `GEMINI_API_KEY` | Yes | For the weekly one-pager ([aistudio.google.com](https://aistudio.google.com/apikey)) |
   | `EMAIL_SENDER` | For Send email | Your sending email (e.g. Gmail) |
   | `EMAIL_PASSWORD` | For Send email | Gmail app password or SMTP password |
   | `SMTP_HOST` | Optional | Default `smtp.gmail.com` |
   | `SMTP_PORT` | Optional | Default `587` |
   | `EMAIL_RECIPIENT` | Optional | Default recipient when none entered in the form |
   | `GITHUB_TOKEN` | Optional | For "Run weekly pulse in cloud" (PAT with `repo` + `workflow`) |
   | `GITHUB_REPO` | Optional | e.g. `owner/repo` |

5. **Deploy.** Generate one-pager and Send email work on the hosted site. If you see a Gemini 404 error, ensure you use a current API key and that the app is using `gemini-2.5-flash` (this is already set in the code).
