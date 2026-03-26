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
  "Water plants",
  "Write one paragraph",
];

const DAY_MS = 24 * 60 * 60 * 1000;

function getTodayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
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
  const todayKey = getTodayKey();
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
    lastResetDay: todayKey,
    lastMidnightCheckDay: null,
    previewHourOverride: "",
  };
}

function getPetMood({ hunger, health, currentHour, hasCompletedToday }) {
  if (health <= 0) return "sick";
  if (hunger <= 0) return "exhausted";
  if (currentHour >= 18 && !hasCompletedToday) return "sad";
  if (hunger < 35) return "hungry";
  return "happy";
}

function getCurrentHour(override) {
  if (override === "") return new Date().getHours();
  const parsed = Number(override);
  if (Number.isNaN(parsed)) return new Date().getHours();
  return clamp(Math.floor(parsed), 0, 23);
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
      return { ...getDefaultState(), ...parsed };
    } catch {
      return getDefaultState();
    }
  });
  const [taskInput, setTaskInput] = useState("");
  const [taskPriority, setTaskPriority] = useState("medium");
  const audioRef = useRef(null);

  const todayKey = getTodayKey();
  const currentHour = getCurrentHour(petState.previewHourOverride);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(petState));
  }, [petState]);

  useEffect(() => {
    const interval = setInterval(() => {
      setPetState((prev) => ({
        ...prev,
        hunger: clamp(prev.hunger - 5, 0, 100),
      }));
    }, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const dayResetInterval = setInterval(() => {
      const nowKey = getTodayKey();
      setPetState((prev) => {
        if (prev.lastResetDay === nowKey) return prev;
        const oneTimeTasks = prev.tasks.filter((task) => task.type === "one-time");
        const dailyHabits = DAILY_HABITS.map((name) => toTask(name, "daily", "medium"));
        const merged = [...dailyHabits, ...oneTimeTasks];
        return {
          ...prev,
          tasks: merged,
          streakBonusDay: null,
          lastResetDay: nowKey,
          completedCountByDay: { ...prev.completedCountByDay, [nowKey]: 0 },
        };
      });
    }, 60 * 1000);
    return () => clearInterval(dayResetInterval);
  }, []);

  useEffect(() => {
    const midnightPenaltyTimer = setInterval(() => {
      const now = new Date();
      const nowKey = getTodayKey(now);
      const hour = now.getHours();
      const minute = now.getMinutes();
      if (hour !== 0 || minute > 5) return;

      setPetState((prev) => {
        if (prev.lastMidnightCheckDay === nowKey) return prev;
        const yesterday = new Date(now.getTime() - DAY_MS);
        const yesterdayKey = getTodayKey(yesterday);
        const hadUnfinishedHighTask = prev.tasks.some(
          (task) => task.priority === "high" && !task.completed
        );
        if (!hadUnfinishedHighTask) {
          return { ...prev, lastMidnightCheckDay: nowKey };
        }
        return {
          ...prev,
          health: clamp(prev.health - 30, 0, 100),
          skullActive: true,
          lastMidnightCheckDay: nowKey,
          completedCountByDay: {
            ...prev.completedCountByDay,
            [yesterdayKey]: prev.completedCountByDay[yesterdayKey] ?? 0,
            [nowKey]: prev.completedCountByDay[nowKey] ?? 0,
          },
        };
      });
    }, 60 * 1000);
    return () => clearInterval(midnightPenaltyTimer);
  }, []);

  const hasCompletedToday = (petState.completedCountByDay[todayKey] ?? 0) > 0;
  const streakBonusActive = petState.streakBonusDay === todayKey;
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
      const willTriggerStreak = todayDone + 1 >= 3;
      const shouldDouble = prev.streakBonusDay === todayKey || willTriggerStreak;
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
        streakBonusDay: willTriggerStreak ? todayKey : prev.streakBonusDay,
      };
    });
    playChime();
  };

  const feedPet = () => {
    setPetState((prev) => {
      const earnedInk = 5;
      let newInk = prev.ink + earnedInk;
      let newLevel = prev.level;
      let needed = newLevel * 100;
      while (newInk >= needed) {
        newInk -= needed;
        newLevel += 1;
        needed = newLevel * 100;
      }

      return {
        ...prev,
        hunger: clamp(prev.hunger + 20, 0, 100),
        ink: newInk,
        level: newLevel,
      };
    });
    playChime(520, 720);
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
                    {streakBonusActive && <span className="pixel-item sparkle-item">SPR</span>}
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
              {streakBonusActive && (
                <p className="bonus">
                  Streak Bonus Active: Ink gains are doubled today and your pet wears a hat.
                </p>
              )}
            </section>

            <section className="controls">
              <button className="feed-button" type="button" onClick={feedPet}>
                Feed
              </button>
              <label className="time-preview">
                Simulate Hour
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={petState.previewHourOverride}
                  onChange={(event) =>
                    setPetState((prev) => ({
                      ...prev,
                      previewHourOverride: event.target.value,
                    }))
                  }
                  placeholder="local hour"
                />
              </label>
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
