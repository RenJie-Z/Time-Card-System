import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

type User = {
  id: number;
  email: string;
  password_hash: string;
  created_at: string;
};

type Checkin = {
  id: number;
  user_id: number;
  date: string;
  total_minutes: number;
  note: string;
  updated_at: string;
};

type StudyTask = {
  id: number;
  user_id: number;
  date: string;
  title: string;
  minutes: number;
  completed: boolean;
  created_at: string;
};

type State = {
  nextUserId: number;
  nextCheckinId: number;
  nextTaskId: number;
  users: User[];
  checkins: Checkin[];
  tasks: StudyTask[];
};

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const STATE_KEY = "state";

function emptyState(): State {
  return {
    nextUserId: 1,
    nextCheckinId: 1,
    nextTaskId: 1,
    users: [],
    checkins: [],
    tasks: [],
  };
}

function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, init);
}

function noContent() {
  return new Response(null, { status: 204 });
}

function now() {
  return new Date().toISOString();
}

function clampMinutes(value: unknown) {
  const numberValue = Number(value) || 0;
  return Math.max(0, Math.min(1440, numberValue));
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    created_at: user.created_at,
  };
}

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const digest = crypto.pbkdf2Sync(password, salt, 210000, 32, "sha256");
  return `pbkdf2_sha256$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [algorithm, saltValue, digestValue] = storedHash.split("$");
  if (algorithm !== "pbkdf2_sha256" || !saltValue || !digestValue) {
    return false;
  }
  const salt = Buffer.from(saltValue, "base64url");
  const expected = Buffer.from(digestValue, "base64url");
  const actual = crypto.pbkdf2Sync(password, salt, 210000, expected.length, "sha256");
  return crypto.timingSafeEqual(actual, expected);
}

function secretKey() {
  return Netlify.env.get("SECRET_KEY") || "change-me-in-development";
}

function signToken(userId: number) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: String(userId), exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }),
  ).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = crypto.createHmac("sha256", secretKey()).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

function verifyToken(token: string) {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) {
    throw new Error("Invalid token");
  }
  const signingInput = `${header}.${payload}`;
  const expected = crypto.createHmac("sha256", secretKey()).update(signingInput).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("Invalid token");
  }
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Expired token");
  }
  return data;
}

async function readState() {
  const store = getStore("study-checkin", { consistency: "strong" });
  return ((await store.get(STATE_KEY, { type: "json" })) as State | null) || emptyState();
}

async function writeState(state: State) {
  const store = getStore("study-checkin", { consistency: "strong" });
  await store.setJSON(STATE_KEY, state);
}

async function requestBody(req: Request) {
  return (await req.json().catch(() => ({}))) as Record<string, unknown>;
}

function routePath(req: Request) {
  const url = new URL(req.url);
  return url.pathname.replace(/^\/api/, "") || "/";
}

function authenticatedUser(req: Request, state: State) {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    return null;
  }
  const payload = verifyToken(token);
  return state.users.find((user) => user.id === Number(payload.sub)) || null;
}

async function handleAuth(req: Request, state: State, path: string) {
  const body = await requestBody(req);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (path === "/auth/register") {
    if (!isEmail(email) || password.length < 6) {
      return json({ detail: "Valid email and a password of at least 6 characters are required" }, { status: 422 });
    }
    if (state.users.some((user) => user.email.toLowerCase() === email)) {
      return json({ detail: "Email already registered" }, { status: 409 });
    }
    const user: User = {
      id: state.nextUserId++,
      email,
      password_hash: hashPassword(password),
      created_at: now(),
    };
    state.users.push(user);
    await writeState(state);
    return json({ access_token: signToken(user.id), token_type: "bearer", user: publicUser(user) }, { status: 201 });
  }

  const user = state.users.find((item) => item.email.toLowerCase() === email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return json({ detail: "Invalid email or password" }, { status: 401 });
  }
  return json({ access_token: signToken(user.id), token_type: "bearer", user: publicUser(user) });
}

async function handleRequest(req: Request) {
  const path = routePath(req);
  const method = req.method.toUpperCase();
  const url = new URL(req.url);
  const state = await readState();

  if (method === "GET" && path === "/health") {
    return json({ status: "ok" });
  }

  if (method === "POST" && (path === "/auth/register" || path === "/auth/login")) {
    return handleAuth(req, state, path);
  }

  const currentUser = authenticatedUser(req, state);
  if (!currentUser) {
    return json({ detail: "Not authenticated" }, { status: 403 });
  }

  if (method === "GET" && path === "/users/me") {
    return json(publicUser(currentUser));
  }

  if (method === "GET" && path === "/checkins/day") {
    const targetDate = url.searchParams.get("date") || "";
    if (!isIsoDate(targetDate)) {
      return json({ detail: "A valid date query parameter is required" }, { status: 422 });
    }
    const checkin = state.checkins.find((item) => item.user_id === currentUser.id && item.date === targetDate) || null;
    const tasks = state.tasks
      .filter((task) => task.user_id === currentUser.id && task.date === targetDate)
      .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id - right.id);
    return json({ date: targetDate, checkin, tasks });
  }

  const checkinMatch = path.match(/^\/checkins\/(\d{4}-\d{2}-\d{2})$/);
  if (method === "PUT" && checkinMatch) {
    const targetDate = checkinMatch[1];
    const body = await requestBody(req);
    let checkin = state.checkins.find((item) => item.user_id === currentUser.id && item.date === targetDate);
    if (!checkin) {
      checkin = { id: state.nextCheckinId++, user_id: currentUser.id, date: targetDate, total_minutes: 0, note: "", updated_at: now() };
      state.checkins.push(checkin);
    }
    checkin.total_minutes = clampMinutes(body.total_minutes);
    checkin.note = String(body.note || "").trim();
    checkin.updated_at = now();
    await writeState(state);
    return json(checkin);
  }

  if (method === "GET" && path === "/checkins/month") {
    const year = Number(url.searchParams.get("year"));
    const month = Number(url.searchParams.get("month"));
    if (!Number.isInteger(year) || year < 1970 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return json({ detail: "Valid year and month query parameters are required" }, { status: 422 });
    }
    const prefix = `${year}-${String(month).padStart(2, "0")}-`;
    const days = state.checkins
      .filter((checkin) => checkin.user_id === currentUser.id && checkin.date.startsWith(prefix))
      .map((checkin) => {
        const tasks = state.tasks.filter((task) => task.user_id === currentUser.id && task.date === checkin.date);
        return {
          date: checkin.date,
          total_minutes: checkin.total_minutes,
          note: checkin.note,
          task_count: tasks.length,
          completed_task_count: tasks.filter((task) => task.completed).length,
        };
      })
      .sort((left, right) => left.date.localeCompare(right.date));
    return json({ year, month, days });
  }

  if (method === "POST" && path === "/tasks") {
    const body = await requestBody(req);
    const date = String(body.date || "");
    const title = String(body.title || "").trim();
    if (!isIsoDate(date) || !title) {
      return json({ detail: "Task date and title are required" }, { status: 422 });
    }
    const task: StudyTask = {
      id: state.nextTaskId++,
      user_id: currentUser.id,
      date,
      title: title.slice(0, 180),
      minutes: clampMinutes(body.minutes),
      completed: false,
      created_at: now(),
    };
    state.tasks.push(task);
    await writeState(state);
    return json(task, { status: 201 });
  }

  const taskMatch = path.match(/^\/tasks\/(\d+)(?:\/toggle)?$/);
  if (taskMatch) {
    const task = state.tasks.find((item) => item.id === Number(taskMatch[1]) && item.user_id === currentUser.id);
    if (!task) {
      return json({ detail: "Task not found" }, { status: 404 });
    }
    if (method === "PATCH" && path.endsWith("/toggle")) {
      task.completed = !task.completed;
      await writeState(state);
      return json(task);
    }
    if (method === "PATCH") {
      const body = await requestBody(req);
      if (body.title !== undefined) {
        task.title = String(body.title || "").trim().slice(0, 180);
      }
      if (!task.title) {
        return json({ detail: "Task title is required" }, { status: 422 });
      }
      if (body.minutes !== undefined) {
        task.minutes = clampMinutes(body.minutes);
      }
      if (body.completed !== undefined) {
        task.completed = Boolean(body.completed);
      }
      await writeState(state);
      return json(task);
    }
    if (method === "DELETE") {
      state.tasks = state.tasks.filter((item) => item.id !== task.id);
      await writeState(state);
      return noContent();
    }
  }

  return json({ detail: "Not found" }, { status: 404 });
}

export default async (req: Request, context: Context) => {
  try {
    return await handleRequest(req);
  } catch (error) {
    console.error(error);
    return json({ detail: "Server error" }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/*",
};
