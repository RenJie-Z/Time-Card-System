# Daily Study Check-in

Vue + Vite frontend and Node.js APIs for daily study check-ins. The app supports email/password auth, JWT authorization, daily tasks, study minutes, notes, and calendar statistics.

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

The production setup uses Netlify for both the Vue frontend and the API. Netlify Functions serve `/api/*`, and Netlify Blobs stores production data.

- Config: `netlify.toml`
- Build base: `frontend`
- Build command: `npm ci && npm run build`
- Publish directory: `frontend/dist`
- Production env var: `VITE_API_BASE_URL=/api`
- Function env var: `SECRET_KEY`

## Tests

```powershell
cd backend
npm test

cd ..\frontend
npm run build
```
