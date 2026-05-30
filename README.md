# Daily Study Check-in

Vue + Vite frontend and Node.js + Express backend for daily study check-ins. The app supports email/password auth, JWT authorization, SQLite storage, daily tasks, study minutes, notes, and calendar statistics.

## Local Backend

```powershell
cd backend
npm install
npm run dev
```

The backend runs at `http://localhost:8000`.

Backend environment variables:

- `PORT`: API port. Defaults to `8000`.
- `SECRET_KEY`: JWT signing secret. Set a strong value in production.
- `DATABASE_URL`: SQLite URL. Defaults to `sqlite:///./study_checkin.db`.
- `ALLOWED_ORIGINS`: Comma-separated CORS origins. Defaults to local Vite URLs.

## Local Frontend

```powershell
cd frontend
npm install
npm run dev
```

The frontend runs at `http://localhost:5173`.

To point the frontend at a different API, create `frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:8000
```

## Production Deployment

The production setup uses Netlify for the Vue frontend and Render for the Node.js API.

Render backend:

- Service name: `daily-study-checkin-api`
- Runtime: Node
- Root directory: `backend`
- Build command: `npm ci`
- Start command: `npm start`
- Health check: `/health`
- Persistent disk: `/var/data`
- `DATABASE_URL=sqlite:////var/data/study_checkin.db`
- `ALLOWED_ORIGINS=https://daily-study-checkin.netlify.app`

Netlify frontend:

- Config: `netlify.toml`
- Build base: `frontend`
- Build command: `npm ci && npm run build`
- Publish directory: `frontend/dist`
- Production env var: `VITE_API_BASE_URL=/api`
- Netlify proxies `/api/*` to `https://daily-study-checkin-api.onrender.com/*` to avoid browser CORS issues.

## Tests

```powershell
cd backend
npm test

cd ..\frontend
npm run build
```
