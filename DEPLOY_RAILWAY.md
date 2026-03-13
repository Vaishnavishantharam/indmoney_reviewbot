# Deploy backend with Docker on Railway

The backend API (Flask) runs the full pipeline (Phase 1 → 2a → 2b → 3) and is containerized with **Docker**. Railway builds from the **Dockerfile** at the repo root.

## Steps

1. **Push your repo to GitHub** (if not already).

2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → select this repository.

3. **Build:** Railway will detect the `Dockerfile` and build the image. Do **not** set a Root Directory (use the repo root so the Dockerfile and all phases are included).

4. **Environment variables** (Railway → your service → Variables):
   | Variable | Required | Description |
   |----------|----------|-------------|
   | `GROQ_API_KEY` | Yes | Groq API key for theme discovery and classification |
   | `GEMINI_API_KEY` | Yes | Gemini API key for the one-pager (Phase 3) |
   | `CORS_ORIGINS` | Optional | Comma-separated origins, e.g. `https://your-app.vercel.app` (default `*`) |

   `PORT` is set by Railway automatically; the Dockerfile uses it.

5. **Deploy:** Railway will build the image and run:
   ```text
   gunicorn -w 1 -b 0.0.0.0:$PORT api_server:app
   ```

6. **Public URL:** In Railway → Settings → Networking → enable **Public Networking** and note the URL (e.g. `https://your-service.railway.app`).

7. In your **Vercel** frontend, set `NEXT_PUBLIC_BACKEND_URL` to this URL (no trailing slash).

## Local Docker test

```bash
docker build -t weekly-pulse-api .
docker run -p 8000:8000 -e GROQ_API_KEY=xxx -e GEMINI_API_KEY=xxx weekly-pulse-api
# POST http://localhost:8000/api/weekly-pulse with {"weeksBack": 10}
```

## Health check

- **GET** `https://your-service.railway.app/health` → `{"ok": true}`
