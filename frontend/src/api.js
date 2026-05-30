const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

async function request(path, options = {}) {
  const token = localStorage.getItem('studyToken');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || '请求失败，请稍后再试');
  }
  return data;
}

export const api = {
  register: (email, password) =>
    request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  login: (email, password) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request('/users/me'),
  getDay: (date) => request(`/checkins/day?date=${date}`),
  saveCheckin: (date, payload) =>
    request(`/checkins/${date}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getMonth: (year, month) => request(`/checkins/month?year=${year}&month=${month}`),
  createTask: (payload) =>
    request('/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTask: (id, payload) =>
    request(`/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  toggleTask: (id) =>
    request(`/tasks/${id}/toggle`, {
      method: 'PATCH',
    }),
  deleteTask: (id) =>
    request(`/tasks/${id}`, {
      method: 'DELETE',
    }),
};
