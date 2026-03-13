# Deploy on Vercel

The **Next.js app (phase5)** can be deployed on Vercel. On Vercel, **Generate one-pager** runs a Node.js pipeline (fetch reviews → Groq themes → classify → Gemini one-pager) and **displays the result on screen**. **Send email to me** sends the one-pager to the recipient you enter using your SMTP credentials.

## Steps

1. **Push your repo to GitHub** (if not already).

2. **In Vercel:** [vercel.com/new](https://vercel.com/new) → Import your Git repository.

3. **Set the Root Directory:** In the project settings (or during import), set **Root Directory** to `phase5`.

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
   | `GITHUB_REPO` | Optional | e.g. `Vaishnavishantharam/indmoney_reviewbot` |

5. **Deploy.** Generate one-pager and Send email work on the hosted site. "Run weekly pulse in cloud" is optional (triggers GitHub Actions workflow).
