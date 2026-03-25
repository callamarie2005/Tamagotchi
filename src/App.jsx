import { useEffect, useMemo, useState } from 'react'
import './App.css'

const STORAGE_KEY = 'habit-gotchi-save-v1'

const DEFAULT_GAME = {
  habits: [],
  tasks: [],
  pet: {
    ink: 0,
    fullness: 60,
    health: 100,
    daysWithoutHabit: 0,
    skullActive: false,
    currentDay: '',
    completedTasksToday: 0,
    streakBonusDay: null,
  },
}

const SPRITES = {
  happy: [
    '0001111000',
    '0012222100',
    '0122222210',
    '1223222321',
    '1222222221',
    '1222332221',
    '1222222221',
    '0122222210',
    '0011111100',
    '0001001000',
  ],
  hungry: [
    '0001111000',
    '0012222100',
    '0122222210',
    '1223222321',
    '1222222221',
    '1223003221',
    '1222332221',
    '0122222210',
    '0011111100',
    '0001001000',
  ],
  sleepy: [
    '0001111000',
    '0012222100',
    '0122222210',
    '1223333321',
    '1222222221',
    '1222332221',
    '1222222221',
    '0122222210',
    '0011111100',
    '0001001000',
  ],
  sad: [
    '0001111000',
    '0012222100',
    '0122222210',
    '1223222321',
    '1222222221',
    '1223222321',
    '1222222221',
    '0122222210',
    '0011111100',
    '0001001000',
  ],
  ghost: [
    '0001111000',
    '0012222100',
    '0123222321',
    '1222222221',
    '1222222221',
    '1222222221',
    '1222222221',
    '0120202010',
    '0011111100',
    '0000000000',
  ],
}

const PRIORITY_XP = {
  low: 5,
  medium: 15,
  high: 30,
}

const ARCHETYPES = [
  { name: 'The Poet', threshold: 0 },
  { name: 'The Librarian', threshold: 120 },
  { name: 'The Scholar', threshold: 260 },
]

const PRIORITY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High (Priority)',
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const formatDay = (date = new Date()) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const addDay = (dayKey) => {
  const [year, month, day] = dayKey.split('-').map(Number)
  const next = new Date(year, month - 1, day + 1)
  return formatDay(next)
}

const withDailyBonus = (base, pet, today) =>
  pet.streakBonusDay === today ? base * 2 : base

const normalizeGame = (loaded, nowDay) => {
  const habits = Array.isArray(loaded?.habits) ? loaded.habits : []
  const tasks = Array.isArray(loaded?.tasks) ? loaded.tasks : []
  const pet = {
    ...DEFAULT_GAME.pet,
    ...(loaded?.pet ?? {}),
    currentDay: loaded?.pet?.currentDay || nowDay,
  }

  const completedToday = tasks.filter((task) => task.completedDay === nowDay).length
  return {
    habits,
    tasks,
    pet: {
      ...pet,
      completedTasksToday: completedToday,
    },
  }
}

const applyDayProgression = (game, nowDay) => {
  if (game.pet.currentDay === nowDay) {
    return game
  }

  const next = {
    ...game,
    habits: [...game.habits],
    tasks: game.tasks.map((task) => ({ ...task })),
    pet: { ...game.pet },
  }

  let cursor = next.pet.currentDay

  while (cursor !== nowDay) {
    const completedHabit = next.habits.some((habit) => habit.lastCompletedDay === cursor)
    next.pet.daysWithoutHabit = completedHabit
      ? 0
      : (next.pet.daysWithoutHabit ?? 0) + 1
    next.pet.fullness = clamp((next.pet.fullness ?? 0) - 20, 0, 100)

    const missedHigh = next.tasks.filter(
      (task) =>
        task.priority === 'high' &&
        !task.completed &&
        task.createdDay === cursor &&
        !task.penaltyApplied,
    )

    if (missedHigh.length > 0) {
      next.tasks = next.tasks.map((task) =>
        missedHigh.some((missed) => missed.id === task.id)
          ? { ...task, penaltyApplied: true }
          : task,
      )
      next.pet.health = clamp((next.pet.health ?? 100) - missedHigh.length * 30, 0, 100)
      next.pet.skullActive = true
    }

    cursor = addDay(cursor)
  }

  next.pet.currentDay = nowDay
  next.pet.completedTasksToday = next.tasks.filter(
    (task) => task.completedDay === nowDay,
  ).length
  next.pet.streakBonusDay = next.pet.streakBonusDay === nowDay ? nowDay : null

  return next
}

const getArchetype = (ink) => {
  let selected = ARCHETYPES[0]
  for (const archetype of ARCHETYPES) {
    if (ink >= archetype.threshold) {
      selected = archetype
    }
  }
  return selected
}

const playChime = () => {
  if (typeof window === 'undefined') {
    return
  }

  const AudioCtx = window.AudioContext || window.webkitAudioContext
  if (!AudioCtx) {
    return
  }

  const audioContext = new AudioCtx()
  const now = audioContext.currentTime

  ;[
    { frequency: 523.25, at: 0, duration: 0.08 },
    { frequency: 659.25, at: 0.09, duration: 0.08 },
    { frequency: 783.99, at: 0.18, duration: 0.1 },
  ].forEach((note) => {
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()

    oscillator.type = 'square'
    oscillator.frequency.value = note.frequency
    gainNode.gain.setValueAtTime(0.0001, now + note.at)
    gainNode.gain.exponentialRampToValueAtTime(0.08, now + note.at + 0.01)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + note.at + note.duration)

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start(now + note.at)
    oscillator.stop(now + note.at + note.duration)
  })
}

const PixelPet = ({ mood, ghostMode, sickMode, skullActive, streakBonus }) => {
  const spriteKey = ghostMode ? 'ghost' : mood
  const sprite = SPRITES[spriteKey] || SPRITES.happy
  const rowLength = sprite[0].length
  const flat = sprite.join('').split('')

  return (
    <div className="relative mx-auto w-fit">
      <div
        className={`pixel-canvas ${sickMode ? 'sick-mode' : ''}`}
        style={{ gridTemplateColumns: `repeat(${rowLength}, minmax(0, 1fr))` }}
      >
        {flat.map((cell, index) => (
          <span
            key={`px-${Math.floor(index / rowLength)}-${index % rowLength}`}
            className="pixel"
            style={{
              background:
                cell === '0'
                  ? 'transparent'
                  : cell === '1'
                    ? '#8B4513'
                    : cell === '2'
                      ? ghostMode
                        ? '#F5F5DC'
                        : '#A9BA9D'
                      : '#3A2414',
            }}
          />
        ))}
      </div>
      {skullActive && !sickMode && (
        <span className="status-icon skull" aria-label="priority missed alert">
          ☠
        </span>
      )}
      {streakBonus && <span className="status-icon hat">🎩</span>}
    </div>
  )
}

function App() {
  const [habitInput, setHabitInput] = useState('')
  const [taskInput, setTaskInput] = useState('')
  const [taskPriority, setTaskPriority] = useState('medium')
  const [now, setNow] = useState(new Date())

  const [game, setGame] = useState(() => {
    const today = formatDay(new Date())
    const raw = localStorage.getItem(STORAGE_KEY)
    const loaded = raw ? JSON.parse(raw) : DEFAULT_GAME
    return applyDayProgression(normalizeGame(loaded, today), today)
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(game))
  }, [game])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const tick = new Date()
      setNow(tick)
      setGame((previous) => applyDayProgression(previous, formatDay(tick)))
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const today = formatDay(now)

  const completedHabitsToday = useMemo(
    () => game.habits.filter((habit) => habit.lastCompletedDay === today).length,
    [game.habits, today],
  )

  const openTasks = useMemo(
    () => game.tasks.filter((task) => !task.completed),
    [game.tasks],
  )

  const doneTasks = useMemo(
    () => game.tasks.filter((task) => task.completed),
    [game.tasks],
  )

  const ghostMode = game.pet.daysWithoutHabit >= 3
  const sickMode = game.pet.health <= 0
  const isAfterSix = now.getHours() >= 18
  const bonusActive = game.pet.streakBonusDay === today

  const petMood = useMemo(() => {
    if (sickMode) {
      return 'sad'
    }
    if (isAfterSix && completedHabitsToday === 0) {
      return 'sad'
    }
    if (now.getHours() >= 22 || now.getHours() < 6) {
      return 'sleepy'
    }
    if (game.pet.fullness < 35) {
      return 'hungry'
    }
    return 'happy'
  }, [completedHabitsToday, game.pet.fullness, isAfterSix, now, sickMode])

  const archetype = getArchetype(game.pet.ink)

  const addHabit = (event) => {
    event.preventDefault()
    const name = habitInput.trim()
    if (!name) return

    setGame((previous) => ({
      ...previous,
      habits: [...previous.habits, { id: makeId(), name, lastCompletedDay: null }],
    }))
    setHabitInput('')
  }

  const completeHabit = (habitId) => {
    setGame((previous) => {
      const habit = previous.habits.find((item) => item.id === habitId)
      if (!habit || habit.lastCompletedDay === today) {
        return previous
      }

      const gain = withDailyBonus(10, previous.pet, today)

      return {
        ...previous,
        habits: previous.habits.map((item) =>
          item.id === habitId ? { ...item, lastCompletedDay: today } : item,
        ),
        pet: {
          ...previous.pet,
          fullness: clamp(previous.pet.fullness + 20, 0, 100),
          health: clamp(previous.pet.health + 5, 0, 100),
          ink: previous.pet.ink + gain,
          daysWithoutHabit: 0,
        },
      }
    })
  }

  const addTask = (event) => {
    event.preventDefault()
    const title = taskInput.trim()
    if (!title) return

    setGame((previous) => ({
      ...previous,
      tasks: [
        ...previous.tasks,
        {
          id: makeId(),
          title,
          priority: taskPriority,
          completed: false,
          createdDay: today,
          completedDay: null,
          penaltyApplied: false,
        },
      ],
    }))
    setTaskInput('')
    setTaskPriority('medium')
  }

  const completeTask = (taskId) => {
    setGame((previous) => {
      const task = previous.tasks.find((item) => item.id === taskId)
      if (!task || task.completed) {
        return previous
      }

      const baseGain = PRIORITY_XP[task.priority] ?? 10
      const inkGain = withDailyBonus(baseGain, previous.pet, today)
      const doneToday = previous.pet.completedTasksToday + 1

      const nextPet = {
        ...previous.pet,
        ink: previous.pet.ink + inkGain,
        health: clamp(previous.pet.health + (task.priority === 'high' ? 15 : 8), 0, 100),
        skullActive: false,
        completedTasksToday: doneToday,
      }

      if (doneToday >= 3 && previous.pet.streakBonusDay !== today) {
        nextPet.streakBonusDay = today
      }

      playChime()

      return {
        ...previous,
        tasks: previous.tasks.map((item) =>
          item.id === taskId
            ? { ...item, completed: true, completedDay: today }
            : item,
        ),
        pet: nextPet,
      }
    })
  }

  const changeTaskPriority = (taskId, priority) => {
    setGame((previous) => ({
      ...previous,
      tasks: previous.tasks.map((task) =>
        task.id === taskId ? { ...task, priority } : task,
      ),
    }))
  }

  return (
    <main
      className={`min-h-screen px-4 py-8 ${
        game.pet.skullActive ? 'bg-[#bfa0a0]' : 'bg-[#F5F5DC]'
      }`}
    >
      <section className="device-shell mx-auto max-w-3xl rounded-3xl border-4 border-[#8B4513] bg-[#efe4ce] p-4 shadow-2xl md:p-6">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b-4 border-dashed border-[#8B4513] pb-4">
          <div>
            <h1 className="text-sm text-[#8B4513] md:text-base">Habit-Gotchi</h1>
            <p className="mt-2 text-[10px] text-[#5e3113] md:text-xs">
              Archetype: {archetype.name}
            </p>
          </div>
          <button
            type="button"
            className="pixel-button border-2 border-[#8B4513] bg-[#A9BA9D] px-3 py-2 text-[10px] text-[#2d1c11] md:text-xs"
          >
            Shop
          </button>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <article className="rounded-xl border-2 border-[#8B4513] bg-[#f8f0dc] p-4">
            <h2 className="mb-3 text-[10px] text-[#6f3f1f] md:text-xs">Pixel Canvas</h2>
            <div className="rounded-xl border-2 border-[#8B4513] bg-[#e2d8be] p-4">
              <PixelPet
                mood={petMood}
                ghostMode={ghostMode}
                sickMode={sickMode}
                skullActive={game.pet.skullActive}
                streakBonus={bonusActive}
              />
              <p className="mt-4 text-center text-[10px] text-[#5e3113] md:text-xs">
                Mood: {ghostMode ? 'Ghostly' : sickMode ? 'Sick Mode' : petMood}
              </p>
            </div>

            <div className="mt-4 space-y-3 text-[9px] text-[#5e3113] md:text-[10px]">
              <div>
                <div className="mb-1 flex justify-between">
                  <span>Ink</span>
                  <span>{game.pet.ink}</span>
                </div>
                <div className="meter">
                  <span
                    style={{
                      width: `${clamp((game.pet.ink % 120) / 1.2, 0, 100)}%`,
                      backgroundColor: '#8B4513',
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 flex justify-between">
                  <span>Fullness</span>
                  <span>{Math.round(game.pet.fullness)}%</span>
                </div>
                <div className="meter">
                  <span
                    style={{
                      width: `${clamp(game.pet.fullness, 0, 100)}%`,
                      backgroundColor: '#A9BA9D',
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 flex justify-between">
                  <span>Health</span>
                  <span>{Math.round(game.pet.health)}%</span>
                </div>
                <div className="meter">
                  <span
                    style={{
                      width: `${clamp(game.pet.health, 0, 100)}%`,
                      backgroundColor: '#8B4513',
                    }}
                  />
                </div>
              </div>
            </div>

            {bonusActive && (
              <p className="mt-3 text-[9px] text-[#5e3113] md:text-[10px]">
                Streak Bonus Active: Ink gains are doubled today.
              </p>
            )}
          </article>

          <article className="space-y-4 rounded-xl border-2 border-[#8B4513] bg-[#f8f0dc] p-4">
            <div>
              <h2 className="mb-3 text-[10px] text-[#6f3f1f] md:text-xs">Daily Habits</h2>
              <form onSubmit={addHabit} className="mb-3 flex gap-2">
                <input
                  value={habitInput}
                  onChange={(event) => setHabitInput(event.target.value)}
                  className="pixel-input flex-1 border-2 border-[#8B4513] bg-[#F5F5DC] px-2 py-2 text-[10px] text-[#2d1c11]"
                  placeholder="Read 10 pages"
                />
                <button
                  type="submit"
                  className="pixel-button border-2 border-[#8B4513] bg-[#A9BA9D] px-3 py-2 text-[10px] text-[#2d1c11]"
                >
                  Add
                </button>
              </form>
              <ul className="space-y-2">
                {game.habits.length === 0 && (
                  <li className="text-[9px] text-[#704727] md:text-[10px]">
                    No habits yet.
                  </li>
                )}
                {game.habits.map((habit) => {
                  const done = habit.lastCompletedDay === today
                  return (
                    <li
                      key={habit.id}
                      className="flex items-center gap-2 rounded border-2 border-[#8B4513] bg-[#efe4ce] px-2 py-2"
                    >
                      <input
                        type="checkbox"
                        checked={done}
                        onChange={() => completeHabit(habit.id)}
                        disabled={done}
                      />
                      <span className="text-[9px] text-[#2d1c11] md:text-[10px]">
                        {habit.name}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div>
              <h2 className="mb-3 text-[10px] text-[#6f3f1f] md:text-xs">One-Time Tasks</h2>
              <form onSubmit={addTask} className="mb-3 grid gap-2 md:grid-cols-[1fr_auto_auto]">
                <input
                  value={taskInput}
                  onChange={(event) => setTaskInput(event.target.value)}
                  className="pixel-input border-2 border-[#8B4513] bg-[#F5F5DC] px-2 py-2 text-[10px] text-[#2d1c11]"
                  placeholder="Water plants"
                />
                <select
                  value={taskPriority}
                  onChange={(event) => setTaskPriority(event.target.value)}
                  className="pixel-input border-2 border-[#8B4513] bg-[#F5F5DC] px-2 py-2 text-[10px] text-[#2d1c11]"
                >
                  <option value="low">Low (+5 Ink)</option>
                  <option value="medium">Medium (+15 Ink)</option>
                  <option value="high">High (+30 Ink)</option>
                </select>
                <button
                  type="submit"
                  className="pixel-button border-2 border-[#8B4513] bg-[#A9BA9D] px-3 py-2 text-[10px] text-[#2d1c11]"
                >
                  Add
                </button>
              </form>

              <ul className="space-y-2">
                {openTasks.length === 0 && (
                  <li className="text-[9px] text-[#704727] md:text-[10px]">
                    No open tasks.
                  </li>
                )}
                {openTasks.map((task) => (
                  <li
                    key={task.id}
                    className="grid gap-2 rounded border-2 border-[#8B4513] bg-[#efe4ce] px-2 py-2 md:grid-cols-[1fr_auto_auto]"
                  >
                    <span className="text-[9px] text-[#2d1c11] md:text-[10px]">{task.title}</span>
                    <select
                      value={task.priority}
                      onChange={(event) => changeTaskPriority(task.id, event.target.value)}
                      className="pixel-input border-2 border-[#8B4513] bg-[#F5F5DC] px-1 py-1 text-[9px] text-[#2d1c11]"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => completeTask(task.id)}
                      className="pixel-button border-2 border-[#8B4513] bg-[#A9BA9D] px-2 py-1 text-[9px] text-[#2d1c11]"
                    >
                      Done
                    </button>
                  </li>
                ))}
              </ul>

              {doneTasks.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[9px] text-[#5e3113] md:text-[10px]">
                    Completed Tasks ({doneTasks.length})
                  </summary>
                  <ul className="mt-2 space-y-2">
                    {doneTasks.map((task) => (
                      <li
                        key={task.id}
                        className="rounded border-2 border-[#8B4513] bg-[#ddd0b4] px-2 py-2 text-[9px] text-[#4b2e1b] md:text-[10px]"
                      >
                        {task.title} [{PRIORITY_LABELS[task.priority]}]
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </article>
        </div>

        <footer className="mt-4 border-t-4 border-dashed border-[#8B4513] pt-3 text-[8px] text-[#5e3113] md:text-[9px]">
          {game.pet.skullActive
            ? 'Priority task missed: pet in trouble mode.'
            : `Habits completed today: ${completedHabitsToday}`}
        </footer>
      </section>
    </main>
  )
}

export default App
