<script setup>
import { computed, onMounted, ref } from 'vue';
import {
  BookOpen,
  CalendarDays,
  Check,
  Flame,
  Loader2,
  LogOut,
  Plus,
  Save,
  Sparkles,
  Timer,
  Trash2,
} from '@lucide/vue';
import { api } from './api';

const todayKey = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
};
const isoDate = (date) => date.toISOString().slice(0, 10);

function getMonthGrid(year, month) {
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const blanks = (first.getDay() + 6) % 7;
  return [
    ...Array.from({ length: blanks }, (_, index) => ({ key: `blank-${index}`, blank: true })),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      return { key: `${year}-${month}-${day}`, day, date: isoDate(new Date(year, month - 1, day)) };
    }),
  ];
}

function calculateStats(monthDays) {
  const dayMap = new Map(monthDays.map((day) => [day.date, day]));
  const totalDays = monthDays.filter((day) => day.total_minutes > 0 || day.completed_task_count > 0).length;
  const totalMinutes = monthDays.reduce((sum, day) => sum + day.total_minutes, 0);
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const weekMinutes = monthDays
    .filter((day) => new Date(day.date) >= new Date(isoDate(monday)))
    .reduce((sum, day) => sum + day.total_minutes, 0);

  let streak = 0;
  const cursor = new Date();
  while (dayMap.has(isoDate(cursor)) && dayMap.get(isoDate(cursor)).total_minutes > 0) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { totalDays, totalMinutes, weekMinutes, streak };
}

const user = ref(null);
const booting = ref(true);
const authMode = ref('login');
const email = ref('');
const password = ref('');
const authLoading = ref(false);
const authError = ref('');
const selectedDate = ref(todayKey());
const current = ref(currentMonth());
const checkin = ref({ total_minutes: 0, note: '' });
const tasks = ref([]);
const monthDays = ref([]);
const newTask = ref('');
const newMinutes = ref(30);
const statusMessage = ref('');
const loading = ref(true);
const saving = ref(false);

const stats = computed(() => calculateStats(monthDays.value));
const monthMap = computed(() => new Map(monthDays.value.map((day) => [day.date, day])));
const monthGrid = computed(() => getMonthGrid(current.value.year, current.value.month));

async function restoreUser() {
  if (!localStorage.getItem('studyToken')) {
    booting.value = false;
    return;
  }
  try {
    user.value = await api.me();
  } catch {
    localStorage.removeItem('studyToken');
  } finally {
    booting.value = false;
  }
}

async function submitAuth() {
  authLoading.value = true;
  authError.value = '';
  try {
    const data = authMode.value === 'login'
      ? await api.login(email.value, password.value)
      : await api.register(email.value, password.value);
    localStorage.setItem('studyToken', data.access_token);
    user.value = data.user;
    await loadData();
  } catch (error) {
    authError.value = error.message;
  } finally {
    authLoading.value = false;
  }
}

async function loadData() {
  loading.value = true;
  try {
    const [dayData, monthData] = await Promise.all([
      api.getDay(selectedDate.value),
      api.getMonth(current.value.year, current.value.month),
    ]);
    checkin.value = dayData.checkin || { total_minutes: 0, note: '' };
    tasks.value = dayData.tasks;
    monthDays.value = monthData.days;
  } catch (error) {
    statusMessage.value = error.message;
  } finally {
    loading.value = false;
  }
}

async function saveCheckin() {
  saving.value = true;
  statusMessage.value = '';
  try {
    checkin.value = await api.saveCheckin(selectedDate.value, {
      total_minutes: Number(checkin.value.total_minutes) || 0,
      note: checkin.value.note || '',
    });
    await loadData();
    statusMessage.value = '今日打卡已保存';
  } catch (error) {
    statusMessage.value = error.message;
  } finally {
    saving.value = false;
  }
}

async function addTask() {
  if (!newTask.value.trim()) return;
  try {
    const task = await api.createTask({
      date: selectedDate.value,
      title: newTask.value.trim(),
      minutes: Number(newMinutes.value) || 0,
    });
    tasks.value = [...tasks.value, task];
    newTask.value = '';
    newMinutes.value = 30;
    statusMessage.value = '任务已添加';
  } catch (error) {
    statusMessage.value = error.message;
  }
}

async function updateTask(id, payload) {
  try {
    const updated = await api.updateTask(id, payload);
    tasks.value = tasks.value.map((task) => (task.id === id ? updated : task));
  } catch (error) {
    statusMessage.value = error.message;
  }
}

async function toggleTask(id) {
  try {
    const updated = await api.toggleTask(id);
    tasks.value = tasks.value.map((task) => (task.id === id ? updated : task));
  } catch (error) {
    statusMessage.value = error.message;
  }
}

async function deleteTask(id) {
  try {
    await api.deleteTask(id);
    tasks.value = tasks.value.filter((task) => task.id !== id);
  } catch (error) {
    statusMessage.value = error.message;
  }
}

function changeMonth(delta) {
  const next = { ...current.value };
  next.month += delta;
  if (next.month < 1) {
    next.year -= 1;
    next.month = 12;
  }
  if (next.month > 12) {
    next.year += 1;
    next.month = 1;
  }
  current.value = next;
  loadData();
}

function resetMonth() {
  current.value = currentMonth();
  loadData();
}

function logout() {
  localStorage.removeItem('studyToken');
  user.value = null;
}

onMounted(async () => {
  await restoreUser();
  if (user.value) {
    await loadData();
  }
});
</script>

<template>
  <main v-if="booting" class="auth-shell">
    <Loader2 class="spin boot-loader" :size="30" />
  </main>

  <main v-else-if="!user" class="auth-shell">
    <section class="auth-panel">
      <div class="brand-mark">
        <Sparkles :size="22" />
      </div>
      <h1>每日学习打卡</h1>
      <p>把今天学过的东西轻轻落在纸上，明天会更容易继续。</p>

      <div class="auth-tabs">
        <button :class="{ active: authMode === 'login' }" type="button" @click="authMode = 'login'">登录</button>
        <button :class="{ active: authMode === 'register' }" type="button" @click="authMode = 'register'">注册</button>
      </div>

      <form class="auth-form" @submit.prevent="submitAuth">
        <label>
          邮箱
          <input v-model="email" type="email" required />
        </label>
        <label>
          密码
          <input v-model="password" type="password" minlength="6" required />
        </label>
        <div v-if="authError" class="error-banner">{{ authError }}</div>
        <button class="primary-button" :disabled="authLoading" type="submit">
          <Loader2 v-if="authLoading" class="spin" :size="18" />
          <Check v-else :size="18" />
          {{ authMode === 'login' ? '进入打卡' : '创建账号' }}
        </button>
      </form>
    </section>
  </main>

  <main v-else class="app-shell">
    <header class="topbar">
      <div>
        <span class="eyebrow">Study Journal</span>
        <h1>每日学习打卡</h1>
      </div>
      <div class="account-area">
        <span>{{ user.email }}</span>
        <button class="icon-button" type="button" title="退出登录" @click="logout">
          <LogOut :size="18" />
        </button>
      </div>
    </header>

    <section class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon"><Flame :size="20" /></div>
        <span>连续打卡</span>
        <strong>{{ stats.streak }} 天</strong>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><CalendarDays :size="20" /></div>
        <span>本月打卡</span>
        <strong>{{ stats.totalDays }} 天</strong>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><Timer :size="20" /></div>
        <span>本周学习</span>
        <strong>{{ stats.weekMinutes }} 分钟</strong>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><BookOpen :size="20" /></div>
        <span>本月累计</span>
        <strong>{{ stats.totalMinutes }} 分钟</strong>
      </div>
    </section>

    <section class="workspace">
      <div class="today-panel">
        <div class="section-title">
          <div>
            <span class="eyebrow">{{ selectedDate }}</span>
            <h2>今日学习页</h2>
          </div>
          <button class="primary-button compact" type="button" :disabled="saving || loading" @click="saveCheckin">
            <Loader2 v-if="saving" class="spin" :size="17" />
            <Save v-else :size="17" />
            保存
          </button>
        </div>

        <div class="checkin-fields">
          <label>
            今日总时长
            <input v-model="checkin.total_minutes" min="0" max="1440" type="number" />
          </label>
          <label>
            学习备注
            <textarea v-model="checkin.note" placeholder="今天读了什么、卡在哪里、明天想继续什么..." />
          </label>
        </div>

        <form class="task-form" @submit.prevent="addTask">
          <input v-model="newTask" placeholder="新增学习任务" />
          <input v-model="newMinutes" min="0" max="1440" type="number" />
          <button class="icon-button add-button" type="submit" title="添加任务">
            <Plus :size="19" />
          </button>
        </form>

        <div class="task-list">
          <div v-if="loading" class="empty-state">正在整理今天的学习页...</div>
          <div v-else-if="tasks.length === 0" class="empty-state">今天还没有任务，写下第一件要完成的事。</div>
          <article v-for="task in tasks" v-else :key="task.id" class="task-item" :class="{ completed: task.completed }">
            <button class="check-button" type="button" @click="toggleTask(task.id)">
              <Check v-if="task.completed" :size="16" />
            </button>
            <input
              v-model="task.title"
              class="task-title-input"
              @blur="updateTask(task.id, { title: task.title })"
            />
            <input
              v-model="task.minutes"
              class="task-minutes-input"
              min="0"
              max="1440"
              type="number"
              @blur="updateTask(task.id, { minutes: Number(task.minutes) || 0 })"
            />
            <span class="minute-label">分钟</span>
            <button class="icon-button subtle" type="button" title="删除任务" @click="deleteTask(task.id)">
              <Trash2 :size="17" />
            </button>
          </article>
        </div>

        <div v-if="statusMessage" class="status-line">{{ statusMessage }}</div>
      </div>

      <aside class="calendar-panel">
        <div class="section-title">
          <div>
            <span class="eyebrow">Monthly Map</span>
            <h2>{{ current.year }} 年 {{ current.month }} 月</h2>
          </div>
          <div class="month-controls">
            <button type="button" @click="changeMonth(-1)">上月</button>
            <button type="button" @click="resetMonth">本月</button>
            <button type="button" @click="changeMonth(1)">下月</button>
          </div>
        </div>

        <div class="weekday-row">
          <span v-for="day in ['一', '二', '三', '四', '五', '六', '日']" :key="day">{{ day }}</span>
        </div>
        <div class="calendar-grid">
          <span v-for="cell in monthGrid" :key="cell.key" class="calendar-cell" :class="cell.blank ? 'blank' : `level-${Math.min(4, Math.ceil((monthMap.get(cell.date)?.total_minutes || 0) / 45))}`" :title="cell.date ? `${cell.date}: ${monthMap.get(cell.date)?.total_minutes || 0} 分钟` : ''">
            {{ cell.blank ? '' : cell.day }}
          </span>
        </div>
      </aside>
    </section>
  </main>
</template>
