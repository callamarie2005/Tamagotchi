import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import tamagotchiShell from "./assets/Gemini_Generated_Image_nbev5gnbev5gnbev.png";

const STORAGE_KEY = "habit_gotchi_v2";

const PRIORITY_REWARD = {
  low: 5,
  medium: 15,
  high: 30,
};

const ARCHETYPES = [
  { name: "The Poet", minLevel: 1, emoji: "🪶" },
  { name: "The Librarian", minLevel: 3, emoji: "📚" },
  { name: "The Scholar", minLevel: 5, emoji: "🕮" },
];

const DAILY_HABITS = [
  "Read 10 pages",
  "Exercise",
  "Write one paragraph",
];

const DAY_MS = 24 * 60 * 60 * 1000;
const VIRTUAL_MINUTE_MS = 60 * 1000;

function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getArchetype(level) {
  return [...ARCHETYPES].reverse().find((item) => level >= item.minLevel) ?? ARCHETYPES[0];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toTask(title, type = "daily", priority = "medium") {
  return {
    id: `${type}_${Math.random().toString(36).slice(2, 10)}`,
    title,
    type,
    priority,
    completed: false,
    completedAt: null,
    createdAt: Date.now(),
  };
}

function getDefaultState() {
  const now = new Date();
  const todayKey = getTodayKey(now);
  const habits = DAILY_HABITS.map((name) => toTask(name, "daily", "medium"));
  return {
    tasks: habits,
    ink: 0,
    level: 1,
    hunger: 100,
    health: 100,
    skullActive: false,
    streakBonusDay: null,
    completedCountByDay: { [todayKey]: 0 },
    completedHabitsByDay: { [todayKey]: 0 },
    habitStreakCount: 0,
    habitDoneStreakActive: false,
    lastResetDay: todayKey,
    lastMidnightCheckDay: null,
    clockInitialized: false,
    initializedAtMs: null,
    virtualNowMs: now.getTime(),
  };
}

function getPetMood({ hunger, health, currentHour, hasCompletedToday }) {
  if (health <= 0) return "sick";
  if (hunger <= 0) return "exhausted";
  if (currentHour >= 18 && !hasCompletedToday) return "sad";
  if (hunger < 35) return "hungry";
  return "happy";
}

function applyMidnightTransition(prev, nextVirtualNowMs) {
  const now = new Date(nextVirtualNowMs);
  const nowKey = getTodayKey(now);
  const prevVirtualMs = prev.virtualNowMs || Date.now();
  const prevKey = getTodayKey(new Date(prevVirtualMs));
  const dayChanged = nowKey !== prevKey;

  let nextState = {
    ...prev,
    virtualNowMs: nextVirtualNowMs,
  };

  const hour = now.getHours();
  const minute = now.getMinutes();
  const atMidnight = hour === 0 && minute === 0;

  if (atMidnight && prev.lastMidnightCheckDay !== nowKey) {
    const totalCount = prev.tasks.length;
    const completedTotal = prev.tasks.filter((task) => task.completed).length;
    const completedRatio = totalCount > 0 ? completedTotal / totalCount : 0;
    const midnightInkBonus = completedRatio > 0.5 ? 10 : 0;

    const hadUnfinishedHighTask = prev.tasks.some(
      (task) => task.priority === "high" && !task.completed
    );
    const hadHabitToday = (prev.completedHabitsByDay[prevKey] ?? 0) > 0;
    const nextHabitStreak = hadHabitToday ? prev.habitStreakCount + 1 : 0;
    const nextStreakActive = nextHabitStreak >= 3;

    let newInk = prev.ink + midnightInkBonus;
    let newLevel = prev.level;
    let needed = newLevel * 100;
    while (newInk >= needed) {
      newInk -= needed;
      newLevel += 1;
      needed = newLevel * 100;
    }

    nextState = {
      ...nextState,
      ink: newInk,
      level: newLevel,
      health: hadUnfinishedHighTask ? clamp(prev.health - 30, 0, 100) : prev.health,
      skullActive: hadUnfinishedHighTask ? true : prev.skullActive,
      habitStreakCount: nextHabitStreak,
      habitDoneStreakActive: nextStreakActive,
      streakBonusDay: nextStreakActive ? nowKey : null,
      lastMidnightCheckDay: nowKey,
    };
  }

  if (dayChanged) {
    const oneTimeTasks = nextState.tasks
      .filter((task) => task.type === "one-time")
      .map((task) => ({ ...task, completed: false, completedAt: null }));
    const dailyHabits = DAILY_HABITS.map((name) => toTask(name, "daily", "medium"));
    nextState = {
      ...nextState,
      tasks: [...dailyHabits, ...oneTimeTasks],
      lastResetDay: nowKey,
      completedCountByDay: { ...nextState.completedCountByDay, [nowKey]: 0 },
      completedHabitsByDay: { ...nextState.completedHabitsByDay, [nowKey]: 0 },
    };
  }

  return nextState;
}

function makeAudioCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  return Ctx ? new Ctx() : null;
}

const SPRITE_TEMPLATE = [
  "................",
  "......kkkk......",
  "....kkwwwwkk....",
  "...kwwwwwwwwk...",
  "..kwwwwwwwwwwk..",
  "..kwwwwwwwwwwk..",
  ".kwwwwwwwwwwwwk.",
  ".kwwwwwwwwwwwwk.",
  ".kwwwwwwwwwwwwk.",
  ".kwwwwwwwwwwwwk.",
  ".kwwwwwwwwwwwwk.",
  "..kwwwwwwwwwwk..",
  "..kwwpwwwwpwwk..",
  "...kkwwwwwwkk...",
  ".....kkkkkk.....",
  "................",
];

const SPRITE_COLORS = {
  k: "#1d1f27",
  w: "#eef9f1",
  p: "#f2a7bf",
  s: "#9fa7a4",
};

function setPixel(sprite, x, y, value) {
  if (x < 0 || y < 0 || y >= sprite.length || x >= sprite[0].length) return;
  sprite[y][x] = value;
}

function buildCreatureSprite(mood) {
  const sprite = SPRITE_TEMPLATE.map((row) => row.split(""));

  if (mood === "sick") {
    for (let y = 0; y < sprite.length; y += 1) {
      for (let x = 0; x < sprite[y].length; x += 1) {
        if (sprite[y][x] === "w" || sprite[y][x] === "p") {
          sprite[y][x] = "s";
        }
      }
    }
  }

  if (mood === "exhausted") {
    [5, 6, 7].forEach((x) => setPixel(sprite, x, 7, "k"));
    [9, 10, 11].forEach((x) => setPixel(sprite, x, 7, "k"));
  } else {
    setPixel(sprite, 6, 7, "k");
    setPixel(sprite, 10, 7, "k");
  }

  if (mood === "sad" || mood === "hungry") {
    setPixel(sprite, 7, 11, "k");
    setPixel(sprite, 8, 10, "k");
    setPixel(sprite, 9, 10, "k");
    setPixel(sprite, 10, 11, "k");
  } else if (mood === "exhausted" || mood === "sick") {
    [7, 8, 9, 10].forEach((x) => setPixel(sprite, x, 11, "k"));
  } else {
    setPixel(sprite, 7, 10, "k");
    setPixel(sprite, 8, 11, "k");
    setPixel(sprite, 9, 11, "k");
    setPixel(sprite, 10, 10, "k");
  }

  if (mood === "sick") {
    setPixel(sprite, 4, 6, "k");
    setPixel(sprite, 11, 5, "k");
    setPixel(sprite, 12, 9, "k");
  }

  return sprite;
}

function PixelCreature({ mood }) {
  const sprite = useMemo(() => buildCreatureSprite(mood), [mood]);

  return (
    <div className={`pixel-creature ${mood}`} role="img" aria-label={`pixel pet ${mood}`}>
      <div className="pixel-sprite">
        {sprite.map((row, y) =>
          row.map((cell, x) =>
            cell === "." ? (
              <span key={`${x}-${y}`} className="pixel-cell empty" />
            ) : (
              <span
                key={`${x}-${y}`}
                className="pixel-cell"
                style={{ backgroundColor: SPRITE_COLORS[cell] ?? "#1d1f27" }}
              />
            )
          )
        )}
      </div>
    </div>
  );
}

function App() {
  const [petState, setPetState] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return getDefaultState();
      const parsed = JSON.parse(raw);
      const merged = { ...getDefaultState(), ...parsed };
      if (!merged.virtualNowMs) {
        merged.virtualNowMs = Date.now();
      }
      return merged;
    } catch {
      return getDefaultState();
    }
  });
  const [taskInput, setTaskInput] = useState("");
  const [taskPriority, setTaskPriority] = useState("medium");
  const [clockInput, setClockInput] = useState("08:00");
  const audioRef = useRef(null);

  const virtualNow = new Date(petState.virtualNowMs || Date.now());
  const todayKey = getTodayKey(virtualNow);
  const currentHour = virtualNow.getHours();

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(petState));
  }, [petState]);

  useEffect(() => {
    if (!petState.clockInitialized) return undefined;
    const interval = setInterval(() => {
      setPetState((prev) => ({
        ...prev,
        hunger: clamp(prev.hunger - 5, 0, 100),
      }));
    }, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [petState.clockInitialized]);

  useEffect(() => {
    if (!petState.clockInitialized) return undefined;
    const clockInterval = setInterval(() => {
      setPetState((prev) => {
        if (!prev.clockInitialized) return prev;
        const nextVirtualNowMs = (prev.virtualNowMs || Date.now()) + 60 * 1000;
        return applyMidnightTransition(prev, nextVirtualNowMs);
      });
    }, VIRTUAL_MINUTE_MS);
    return () => clearInterval(clockInterval);
  }, [petState.clockInitialized]);

  const hasCompletedToday = (petState.completedCountByDay[todayKey] ?? 0) > 0;
  const streakBonusActive = petState.habitDoneStreakActive;
  const archetype = getArchetype(petState.level);
  const mood = getPetMood({
    hunger: petState.hunger,
    health: petState.health,
    currentHour,
    hasCompletedToday,
  });

  const pagesToNextLevel = useMemo(() => petState.level * 100, [petState.level]);

  const completeTask = (taskId) => {
    setPetState((prev) => {
      const task = prev.tasks.find((item) => item.id === taskId);
      if (!task || task.completed) return prev;

      const baseInk = PRIORITY_REWARD[task.priority] ?? 5;
      const todayDone = prev.completedCountByDay[todayKey] ?? 0;
      const shouldDouble = prev.habitDoneStreakActive;
      const earnedInk = shouldDouble ? baseInk * 2 : baseInk;

      let newInk = prev.ink + earnedInk;
      let newLevel = prev.level;
      let needed = newLevel * 100;
      while (newInk >= needed) {
        newInk -= needed;
        newLevel += 1;
        needed = newLevel * 100;
      }

      const updatedTasks = prev.tasks.map((item) =>
        item.id === taskId ? { ...item, completed: true, completedAt: Date.now() } : item
      );

      return {
        ...prev,
        tasks: updatedTasks,
        ink: newInk,
        level: newLevel,
        hunger: clamp(prev.hunger + 20, 0, 100),
        skullActive: false,
        completedCountByDay: {
          ...prev.completedCountByDay,
          [todayKey]: todayDone + 1,
        },
        completedHabitsByDay: {
          ...prev.completedHabitsByDay,
          [todayKey]:
            (prev.completedHabitsByDay[todayKey] ?? 0) + (task.type === "daily" ? 1 : 0),
        },
      };
    });
    playChime();
  };

  const feedPet = () => {
    setPetState((prev) => {
      return {
        ...prev,
        hunger: clamp(prev.hunger + 20, 0, 100),
      };
    });
    playChime(520, 720);
  };

  const initializeClock = (event) => {
    event.preventDefault();
    const [h, m] = clockInput.split(":");
    const hour = clamp(Number(h), 0, 23);
    const minute = clamp(Number(m), 0, 59);
    const base = new Date();
    base.setHours(hour, minute, 0, 0);
    const nowKey = getTodayKey(base);
    setPetState((prev) => ({
      ...prev,
      clockInitialized: true,
      initializedAtMs: Date.now(),
      virtualNowMs: base.getTime(),
      lastResetDay: nowKey,
      completedCountByDay: { ...prev.completedCountByDay, [nowKey]: prev.completedCountByDay[nowKey] ?? 0 },
      completedHabitsByDay: {
        ...prev.completedHabitsByDay,
        [nowKey]: prev.completedHabitsByDay?.[nowKey] ?? 0,
      },
    }));
  };

  const advanceVirtualTime = (minutes) => {
    setPetState((prev) => {
      if (!prev.clockInitialized) return prev;
      const nextVirtualNowMs = (prev.virtualNowMs || Date.now()) + minutes * 60 * 1000;
      return applyMidnightTransition(prev, nextVirtualNowMs);
    });
  };

  const addOneTimeTask = (event) => {
    event.preventDefault();
    const title = taskInput.trim();
    if (!title) return;
    setPetState((prev) => ({
      ...prev,
      tasks: [...prev.tasks, toTask(title, "one-time", taskPriority)],
    }));
    setTaskInput("");
    setTaskPriority("medium");
  };

  const playChime = (f1 = 660, f2 = 880) => {
    if (!audioRef.current) {
      audioRef.current = makeAudioCtx();
    }
    const ctx = audioRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") {
      ctx.resume();
    }

    const now = ctx.currentTime;
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const gain = ctx.createGain();

    oscA.type = "triangle";
    oscA.frequency.setValueAtTime(f1, now);
    oscB.type = "square";
    oscB.frequency.setValueAtTime(f2, now + 0.09);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);

    oscA.connect(gain);
    oscB.connect(gain);
    gain.connect(ctx.destination);

    oscA.start(now);
    oscB.start(now + 0.08);
    oscA.stop(now + 0.28);
    oscB.stop(now + 0.32);
  };

  const taskGroups = useMemo(() => {
    return {
      daily: petState.tasks.filter((task) => task.type === "daily"),
      oneTime: petState.tasks.filter((task) => task.type === "one-time"),
    };
  }, [petState.tasks]);

  return (
    <main className="app-shell">
      <section className={`device ${mood === "sick" ? "sick-mode" : ""}`}>
        <header className="device-header">
          <h1>Habit-Gotchi</h1>
          <button className="shop-button" type="button">
            Shop
          </button>
        </header>
        <div className="device-grid">
          <div className="left-panel">
            <section className="pixel-canvas" aria-live="polite">
              <div className="tamagotchi-shell" style={{ backgroundImage: `url(${tamagotchiShell})` }}>
                <div className="tamagotchi-screen">
                  <div className="screen-top-icons">
                    <span className="pixel-bubble">❤</span>
                    <span className="pixel-bubble">✒</span>
                  </div>
                  <div className={`pet ${mood}`}>
                    {streakBonusActive && <span className="pixel-item hat-item">HAT</span>}
                    <span className="pet-core">
                      <PixelCreature mood={mood} />
                    </span>
                    {petState.skullActive && <span className="pixel-item skull-item">SKL</span>}
                  </div>
                  <div className="screen-footer">
                    <span>HABIT-GOTCHI</span>
                    <span>STATUS: {mood.toUpperCase()}</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="habit-section">
              <h2>Daily Habits</h2>
              <ul>
                {taskGroups.daily.map((task) => (
                  <li key={task.id} className={task.completed ? "done" : ""}>
                    <label>
                      <input
                        type="checkbox"
                        checked={task.completed}
                        onChange={() => completeTask(task.id)}
                      />
                      <span>{task.title}</span>
                    </label>
                    <small>{task.priority.toUpperCase()}</small>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className="right-panel">
            {!petState.clockInitialized && (
              <section className="clock-init">
                <h2>Initialize Clock</h2>
                <form onSubmit={initializeClock}>
                  <label>
                    Start Time
                    <input
                      type="time"
                      value={clockInput}
                      onChange={(event) => setClockInput(event.target.value)}
                      required
                    />
                  </label>
                  <button type="submit">Start Tracking</button>
                </form>
              </section>
            )}
            <section className="stats">
              <div className="stat-row">
                <span>Archetype</span>
                <strong>
                  {archetype.name} (Lv {petState.level})
                </strong>
              </div>
              <div className="stat-row">
                <span>Ink Pages</span>
                <strong>
                  {petState.ink} / {pagesToNextLevel}
                </strong>
              </div>
              <div className="bar-wrap">
                <label htmlFor="ink-bar">Pages to Next Archetype</label>
                <div className="bar-track">
                  <div
                    id="ink-bar"
                    className="bar-fill ink"
                    style={{ width: `${(petState.ink / pagesToNextLevel) * 100}%` }}
                  />
                </div>
              </div>
              <div className="bar-wrap">
                <label htmlFor="hunger-bar">Hunger</label>
                <div className="bar-track">
                  <div
                    id="hunger-bar"
                    className="bar-fill hunger"
                    style={{ width: `${petState.hunger}%` }}
                  />
                </div>
                <span className="bar-meta">{petState.hunger}%</span>
              </div>
              <div className="bar-wrap">
                <label htmlFor="health-bar">Health</label>
                <div className="bar-track">
                  <div
                    id="health-bar"
                    className="bar-fill health"
                    style={{ width: `${petState.health}%` }}
                  />
                </div>
                <span className="bar-meta">{petState.health}%</span>
              </div>
              <div className="stat-row">
                <span>Clock</span>
                <strong>
                  {virtualNow.toLocaleDateString()} {String(currentHour).padStart(2, "0")}:
                  {String(virtualNow.getMinutes()).padStart(2, "0")}
                </strong>
              </div>
              <div className="stat-row">
                <span>Habit Streak</span>
                <strong>{petState.habitStreakCount} days</strong>
              </div>
            </section>

            <section className="controls">
              <button
                className="feed-button"
                type="button"
                onClick={feedPet}
                disabled={!petState.clockInitialized}
              >
                Feed
              </button>
              <span className="control-note">Ink +10 at midnight if &gt;50% tasks+habits complete.</span>
              <button
                className="time-advance-button"
                type="button"
                onClick={() => advanceVirtualTime(60)}
                disabled={!petState.clockInitialized}
              >
                +1h
              </button>
              <button
                className="time-advance-button"
                type="button"
                onClick={() => advanceVirtualTime(24 * 60)}
                disabled={!petState.clockInitialized}
              >
                +1d
              </button>
            </section>

            <section className="habit-section one-time">
              <h2>One-Time Tasks</h2>
              <form className="task-form" onSubmit={addOneTimeTask}>
                <input
                  type="text"
                  value={taskInput}
                  onChange={(event) => setTaskInput(event.target.value)}
                  placeholder="Add one-time task..."
                />
                <div className="priority-toggle">
                  {["low", "medium", "high"].map((level) => (
                    <label key={level}>
                      <input
                        type="radio"
                        name="priority"
                        value={level}
                        checked={taskPriority === level}
                        onChange={(event) => setTaskPriority(event.target.value)}
                      />
                      {level}
                    </label>
                  ))}
                </div>
                <button type="submit">Add Task</button>
              </form>
              <ul>
                {taskGroups.oneTime.length === 0 && (
                  <li className="empty-row">
                    <span>No one-time tasks yet.</span>
                  </li>
                )}
                {taskGroups.oneTime.map((task) => (
                  <li key={task.id} className={task.completed ? "done" : ""}>
                    <label>
                      <input
                        type="checkbox"
                        checked={task.completed}
                        onChange={() => completeTask(task.id)}
                      />
                      <span>{task.title}</span>
                    </label>
                    <small className={task.priority === "high" ? "critical" : ""}>
                      {task.priority === "high" ? "CRITICAL" : task.priority.toUpperCase()}
                    </small>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
