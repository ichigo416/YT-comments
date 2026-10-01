# YouTube Comment Toxicity Scorer

Chrome extension (Manifest V3) that scores YouTube comments for toxicity and badges or blurs the toxic ones.

```
content.ts  ── chrome.runtime.sendMessage ──▶  background.ts (service worker)
(reads comments, renders badges)                      │  HTTPS POST /api/score
                                                      ▼
                                   server/  Express gateway (zod, helmet, rate limit, origin allowlist)
                                                      │  POST /predict/batch + X-Internal-Token
                                                      ▼
                                   inference/  FastAPI + scikit-learn model (localhost only)
```

## File structure

```
yt-comment-scorer/
├─ ml/
│  ├─ requirements.txt
│  └─ train_baseline.py          TF-IDF + logistic regression on Jigsaw, saves ml/artifacts/*.joblib
├─ inference/
│  ├─ requirements.txt
│  ├─ .env.example
│  └─ app.py                     FastAPI: GET /health, POST /predict/batch (token protected)
├─ server/
│  ├─ package.json, tsconfig.json, .env.example
│  └─ src/
│     ├─ index.ts                entry point + graceful shutdown
│     ├─ app.ts                  helmet, origin allowlist, CORS, body limit, rate limit, error handler
│     ├─ config.ts               zod-validated environment
│     ├─ schemas.ts              request/response schemas and limits
│     ├─ routes/score.ts         POST /api/score
│     └─ services/scorer.ts      calls the inference service (timeout + response validation)
└─ extension/
   ├─ package.json, tsconfig.json, build.mjs
   ├─ static/                    popup.html, popup.css, content.css
   └─ src/
      ├─ background.ts           validates sender + message, calls the gateway
      ├─ content.ts              MutationObserver, batching, cache, badge/blur rendering
      ├─ env.d.ts
      ├─ shared/                 types.ts, settings.ts
      └─ popup/                  main.tsx, Popup.tsx
```

## Run it

### 1. Train the baseline model
Download `train.csv` from the Kaggle "Jigsaw Toxic Comment Classification Challenge" into `ml/data/`.
```bash
cd ml
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python train_baseline.py --train-csv data/train.csv
```

### 2. Start the inference service
```bash
cd inference
pip install -r requirements.txt
cp .env.example .env            # set INTERNAL_TOKEN (openssl rand -hex 32)
uvicorn app:app --host 127.0.0.1 --port 8000 --env-file .env
```

### 3. Start the gateway
```bash
cd server
npm install
cp .env.example .env            # same INTERNAL_TOKEN as above
npm run dev
```

### 4. Build and load the extension
```bash
cd extension
npm install
npm run build                   # API_BASE_URL=https://api.yourdomain.com npm run build  for production
```
Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and choose `extension/dist`.
Copy the extension ID, set `ALLOWED_ORIGINS=chrome-extension://<id>` in `server/.env`, and restart the gateway.
Open any YouTube video and scroll to the comments.

## Security notes

- The extension holds no secrets. The gateway is protected by an origin allowlist, per-IP rate limiting, strict schemas and size limits. An allowlisted origin can be spoofed by non-browser clients, so rate limiting is the real abuse control; add per-user auth before you publish widely.
- The inference service is internal: it binds to 127.0.0.1, requires a shared token (constant-time comparison) and has its API docs disabled.
- Comment text is never logged or stored. It is rendered only via `textContent`, never `innerHTML`.
- Manifest permissions are limited to `storage`, youtube.com and your API origin. `build.mjs` refuses non-HTTPS API URLs except for localhost.
- `joblib` files are pickles: only load models you trained yourself.
- In production, put the gateway behind HTTPS (nginx/Caddy/Cloudflare) and set `TRUST_PROXY=1`.
- If you publish to the Chrome Web Store you need a privacy policy, since comments are sent to your server.

## Known limits (phase 1)

- Toxicity only. The quality/constructiveness score is phase 2 (multi-task DistilBERT with the C3 dataset).
- The TF-IDF baseline over-flags comments that merely mention identity terms; the bias evaluation is phase 2.
- YouTube changes its markup regularly. If comments stop being detected, update `COMMENT_TEXT_SELECTOR` in `extension/src/content.ts`.
