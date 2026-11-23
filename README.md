# Jones Navigator

An AI guide that helps Rice Business (Jones Graduate School of Business) students find resources, clubs, and alumni, and plan their 2-year MBA. Student-built for a BUSI 233 capstone. Not an official Rice University service.

**Live site:** https://ethatch15.github.io/jones-navigator/ (after the steps below)

## How it works
```
Student's browser ──► GitHub Pages site (docs/) ──► Cloudflare Worker (worker/) ──► Claude API
                        public HTML, no secrets       holds the Claude key           claude-sonnet-5-5
```
- `docs/`: the website. GitHub Pages serves this folder.
- `worker/`: a small Cloudflare Worker. It adds the Jones Navigator instructions and knowledge files to each question, calls Claude with your key, and only accepts requests from your site.
- `jones-navigator-gpt/`: the source content (instructions and 5 knowledge files). Edit these to change what the assistant knows.

**The API key never goes in this repo.** It's stored as a Cloudflare secret.

## One-time setup

### 1. Protect your Claude Console account
In the Claude Console (platform.claude.com), add prepaid credit under **Billing** and set a low monthly spend limit under **Limits** (for example $10). The site is public, so this is your safety net.

### 2. Deploy the Worker (free Cloudflare account)
Run these in a terminal from the `worker` folder:

```bash
cd worker
```

```bash
npx wrangler login
```

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```
Paste your Claude API key (it starts with `sk-ant-`) when it asks. It's stored encrypted on Cloudflare.

```bash
npx wrangler deploy
```
It prints a URL like `https://jones-navigator.<your-subdomain>.workers.dev`.

### 3. Connect the site to the Worker
Open `docs/config.js` and replace the placeholder with your Worker URL plus `/chat`:
```js
window.JONES_NAVIGATOR_API = "https://jones-navigator.<your-subdomain>.workers.dev/chat";
```
Commit and push. GitHub Pages updates in about a minute.

### 4. Try it
Open the live site and ask a starter question.

## Updating the knowledge
1. Edit files in `jones-navigator-gpt/` (for example, the club roster each semester).
2. Rebuild and redeploy the Worker:
```bash
cd worker && npm install && npm run deploy
```

## Settings (worker/wrangler.toml)
| Setting | Default | What it does |
|---|---|---|
| `ALLOWED_ORIGINS` | your GitHub Pages site and localhost:8000 | Sites allowed to use the Worker |
| `MODEL` | `claude-sonnet-5-5` | Claude model. `claude-opus-5-5` gives the most capable answers at about twice the cost |
| `EFFORT` | `low` | How hard Claude thinks before answering (`low`, `medium`, `high`) |
| `WEB_SEARCH` | `on` | Lets Claude search rice.edu sites for current info. Set it to `off` to save money |
| `MAX_TOKENS` | `16000` | Caps the length (and cost) of each answer |

If chats show "The AI service returned an error," run `npx wrangler tail` in `worker/` while you send a message to see the API's exact error.

## Test locally without spending money
```bash
cd worker && echo 'MOCK = "1"' > .dev.vars && npx wrangler dev --port 8787
```
In a second terminal, from the repo root:
```bash
python3 -m http.server 8000 --directory docs
```
Then open http://localhost:8000/?api=http://localhost:8787/chat. Test mode sends back a sample answer without calling the API. Delete `.dev.vars` (and put your key there as `ANTHROPIC_API_KEY = "..."` if you want real local answers). `.dev.vars` is git-ignored.
