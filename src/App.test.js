import { describe, it, expect } from "vitest";

const DAY_MS = 24 * 60 * 60 * 1000;

const DAILY_HABITS = ["Read 10 pages", "Exercise", "Write one paragraph"];

function getTodayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function toTask(title, type = "daily", priority = "medium", completed = false) {
  return {
    id: `${type}_${title}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    type,
    priority,
    completed,
    completedAt: completed ? Date.now() : null,
  };
}

function applyVirtualTick(state, minutesToAdvance) {
  const nextVirtualNowMs = state.virtualNowMs + minutesToAdvance * 60 * 1000;
  const now = new Date(nextVirtualNowMs);
  const nowKey = getTodayKey(now);
  const prevKey = getTodayKey(new Date(state.virtualNowMs));
  const dayChanged = nowKey !== prevKey;

  let nextState = {
    ...state,
    virtualNowMs: nextVirtualNowMs,
  };

  if (dayChanged) {
    const totalCount = state.tasks.length;
    const completedTotal = state.tasks.filter((task) => task.completed).length;
    const completedRatio = totalCount > 0 ? completedTotal / totalCount : 0;
    const midnightInkBonus = completedRatio > 0.5 ? 10 : 0;
    const hadHabitToday = (state.completedHabitsByDay[prevKey] ?? 0) > 0;
    const nextHabitStreak = hadHabitToday ? state.habitStreakCount + 1 : 0;
    const nextStreakActive = nextHabitStreak >= 3;

    nextState = {
      ...nextState,
      ink: state.ink + midnightInkBonus,
      habitStreakCount: nextHabitStreak,
      habitDoneStreakActive: nextStreakActive,
      streakBonusDay: nextStreakActive ? nowKey : null,
      lastMidnightCheckDay: nowKey,
    };

    const oneTimeTasks = state.tasks
      .filter((task) => task.type === "one-time")
      .map((task) => ({ ...task, completed: false, completedAt: null }));
    const dailyHabits = DAILY_HABITS.map((name) => toTask(name, "daily", "medium", false));

    nextState = {
      ...nextState,
      tasks: [...dailyHabits, ...oneTimeTasks],
      completedCountByDay: { ...nextState.completedCountByDay, [nowKey]: 0 },
      completedHabitsByDay: { ...nextState.completedHabitsByDay, [nowKey]: 0 },
      lastResetDay: nowKey,
    };
  }

  return nextState;
}

describe("virtual day rollover rules", () => {
  it("adds +10 ink when >50% combined items completed and resets checks", () => {
    const start = new Date("2026-03-25T23:58:00.000Z");
    const dayKey = getTodayKey(start);
    const state = {
      virtualNowMs: start.getTime(),
      ink: 60,
      tasks: [
        toTask("Read 10 pages", "daily", "medium", true),
        toTask("Exercise", "daily", "medium", true),
        toTask("Write one paragraph", "daily", "medium", false),
        toTask("Task 1", "one-time", "high", true),
      ],
      completedCountByDay: { [dayKey]: 3 },
      completedHabitsByDay: { [dayKey]: 2 },
      habitStreakCount: 1,
      habitDoneStreakActive: false,
      streakBonusDay: null,
      lastMidnightCheckDay: null,
      lastResetDay: dayKey,
    };

    const next = applyVirtualTick(state, 60);
    const nextKey = getTodayKey(new Date(next.virtualNowMs));
    expect(next.ink).toBe(70);
    expect(next.tasks.every((task) => task.completed === false)).toBe(true);
    expect(next.completedCountByDay[nextKey]).toBe(0);
    expect(next.completedHabitsByDay[nextKey]).toBe(0);
  });

  it("streak hat activates only after habit completion for 3 days", () => {
    const day1 = new Date("2026-03-25T23:58:00.000Z");
    const key1 = getTodayKey(day1);
    const state = {
      virtualNowMs: day1.getTime(),
      ink: 0,
      tasks: [
        toTask("Read 10 pages", "daily", "medium", true),
        toTask("Exercise", "daily", "medium", false),
        toTask("Write one paragraph", "daily", "medium", false),
      ],
      completedCountByDay: { [key1]: 1 },
      completedHabitsByDay: { [key1]: 1 },
      habitStreakCount: 2,
      habitDoneStreakActive: false,
      streakBonusDay: null,
      lastMidnightCheckDay: null,
      lastResetDay: key1,
    };

    const next = applyVirtualTick(state, 60);
    expect(next.habitStreakCount).toBe(3);
    expect(next.habitDoneStreakActive).toBe(true);
  });

  it("one-time tasks alone do not advance habit streak", () => {
    const day1 = new Date("2026-03-25T23:58:00.000Z");
    const key1 = getTodayKey(day1);
    const state = {
      virtualNowMs: day1.getTime(),
      ink: 0,
      tasks: [
        toTask("Read 10 pages", "daily", "medium", false),
        toTask("Exercise", "daily", "medium", false),
        toTask("Write one paragraph", "daily", "medium", false),
        toTask("Task only", "one-time", "medium", true),
      ],
      completedCountByDay: { [key1]: 1 },
      completedHabitsByDay: { [key1]: 0 },
      habitStreakCount: 2,
      habitDoneStreakActive: false,
      streakBonusDay: null,
      lastMidnightCheckDay: null,
      lastResetDay: key1,
    };

    const next = applyVirtualTick(state, 60);
    expect(next.habitStreakCount).toBe(0);
    expect(next.habitDoneStreakActive).toBe(false);
  });
});
