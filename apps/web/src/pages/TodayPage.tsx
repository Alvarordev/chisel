import { useEffect, useMemo, useState } from "react";
import type { DayHabit, DayResponse, Task } from "@chisel/contracts";
import { completeTask, getDay, UnauthorizedError } from "../lib/api";
import { Icon } from "../components/Icon";

function todayIso(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function readableDate(value: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${value}T12:00:00`));
}

function blockLabel(block: string | null): string {
  if (block === "morning") return "Mañana";
  if (block === "afternoon") return "Tarde";
  if (block === "evening") return "Noche";
  return "Sin bloque";
}

function blockOrder(block: string | null): number {
  if (block === "morning") return 0;
  if (block === "afternoon") return 1;
  if (block === "evening") return 2;
  return 3;
}

function TaskRow({ task, busy, onComplete }: { task: Task; busy: boolean; onComplete: () => void }) {
  const itemsDone = task.items?.filter((item) => item.done).length ?? 0;
  const itemsTotal = task.items?.length ?? 0;

  return (
    <article className={`task-row${task.status === "done" ? " is-done" : ""}`}>
      <button
        aria-label={task.status === "done" ? `${task.action} completada` : `Completar ${task.action}`}
        className={`task-check${task.status === "done" ? " is-checked" : ""}`}
        disabled={busy || task.status === "done"}
        onClick={onComplete}
        type="button"
      >
        {task.status === "done" && <Icon name="check" size={15} />}
      </button>
      <div className="task-copy">
        <div className="task-title-line">
          <h3>{task.action}</h3>
          <span className={`weight weight-${task.weight.toLowerCase()}`}>{task.weight}</span>
        </div>
        <p>{task.doneWhen}</p>
        {task.kind === "batch" && itemsTotal > 0 && (
          <div className="batch-detail">
            <div className="batch-progress-line">
              <span>{itemsDone}/{itemsTotal} pasos</span>
              <span>{Math.round((itemsDone / itemsTotal) * 100)}%</span>
            </div>
            <div className="progress-track small"><span style={{ width: `${(itemsDone / itemsTotal) * 100}%` }} /></div>
          </div>
        )}
      </div>
      <div className="task-meta">
        {task.dueTime && <span>{task.dueTime}</span>}
        <span>{task.estimatedMinutes} min</span>
      </div>
    </article>
  );
}

function HabitRow({ habit, busy, onComplete }: { habit: DayHabit; busy: boolean; onComplete: (mode: "full" | "floor") => void }) {
  const done = habit.status === "done";

  return (
    <article className={`habit-row${done ? " is-done" : ""}`}>
      <div className="habit-symbol"><Icon name="sun" size={17} /></div>
      <div className="habit-copy">
        <div className="task-title-line">
          <h3>{habit.action}</h3>
          {done && <span className="completion-pill">{habit.completionMode === "floor" ? "Floor" : "Full"}</span>}
        </div>
        <p>{done ? (habit.completionMode === "floor" ? habit.habitFloor : habit.fullDesc) : habit.fullDesc}</p>
      </div>
      {!done ? (
        <div className="habit-actions">
          <button className="secondary-button compact-button" disabled={busy} onClick={() => onComplete("floor")} type="button">
            Floor <span>{habit.floorMinutes}m</span>
          </button>
          <button className="primary-button compact-button" disabled={busy} onClick={() => onComplete("full")} type="button">
            Full <span>{habit.fullMinutes}m</span>
          </button>
        </div>
      ) : (
        <div className="task-check is-checked static-check"><Icon name="check" size={15} /></div>
      )}
    </article>
  );
}

export function TodayPage() {
  const [date, setDate] = useState(todayIso);
  const [day, setDay] = useState<DayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  async function loadDay(nextDate: string) {
    setLoading(true);
    setError("");
    try {
      setDay(await getDay(nextDate));
    } catch (caught) {
      if (caught instanceof UnauthorizedError) return;
      setError("No pudimos cargar este día. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDay(date);
  }, [date]);

  const groupedTasks = useMemo(() => {
    if (!day) return [];
    const groups = new Map<string, Task[]>();
    for (const task of day.tasks) {
      const key = task.block ?? "none";
      groups.set(key, [...(groups.get(key) ?? []), task]);
    }
    return [...groups.entries()].sort(([a], [b]) => blockOrder(a === "none" ? null : a) - blockOrder(b === "none" ? null : b));
  }, [day]);

  async function finishTask(taskId: string, completionMode?: "full" | "floor") {
    setBusyId(taskId);
    setError("");
    try {
      await completeTask(taskId, completionMode ? { completionMode } : {});
      await loadDay(date);
    } catch {
      setError("No pudimos guardar ese cambio.");
    } finally {
      setBusyId("");
    }
  }

  const taskCount = day?.tasks.length ?? 0;
  const habitCount = day?.habits.length ?? 0;
  const completedTasks = day?.tasks.filter((task) => task.status === "done").length ?? 0;
  const completedHabits = day?.habits.filter((habit) => habit.status === "done").length ?? 0;
  const totalPoints = day?.tasks.reduce((total, task) => total + task.points, 0) ?? 0;
  const completedPoints = day?.tasks.filter((task) => task.status === "done").reduce((total, task) => total + task.points, 0) ?? 0;
  const totalItems = taskCount + habitCount;
  const completedItems = completedTasks + completedHabits;
  const progress = totalItems ? Math.round((completedItems / totalItems) * 100) : 0;

  return (
    <div className="page-wrap today-page">
      <header className="page-header today-header">
        <div>
          <p className="eyebrow">Tu día, en una mirada</p>
          <h1>{readableDate(date)}</h1>
        </div>
        <div className="date-controls" aria-label="Cambiar día">
          <button className="icon-button" onClick={() => setDate((current) => shiftDate(current, -1))} type="button" aria-label="Día anterior">
            <Icon name="chevron-left" size={18} />
          </button>
          <button className="today-button" onClick={() => setDate(todayIso())} type="button">Hoy</button>
          <button className="icon-button" onClick={() => setDate((current) => shiftDate(current, 1))} type="button" aria-label="Día siguiente">
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      </header>

      <section className="done-log-card">
        <div className="done-log-copy">
          <div className="done-log-icon"><Icon name="check" size={20} /></div>
          <div>
            <p className="eyebrow light">Done-log</p>
            <h2>{completedPoints} <span>/ {totalPoints} puntos</span></h2>
            <p>{completedItems === 0 ? "El primer paso todavía cuenta." : `${completedItems} de ${totalItems} compromisos cerrados.`}</p>
          </div>
        </div>
        <div className="done-log-progress">
          <span>{progress}%</span>
          <div className="progress-track inverse"><span style={{ width: `${progress}%` }} /></div>
        </div>
      </section>

      {error && <div className="inline-error" role="alert">{error}</div>}

      {loading ? (
        <div className="loading-stack" aria-label="Cargando día">
          <div className="skeleton skeleton-large" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : (
        <>
          <section className="day-section agenda-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Contexto del día</p>
                <h2>Agenda</h2>
              </div>
              <span className="section-count">{day?.agenda.length ?? 0} compromisos</span>
            </div>
            {day?.agenda.length ? (
              <div className="agenda-list">
                {day.agenda.map((item) => (
                  <article className="agenda-row" key={item.id}>
                    <div className="agenda-time">
                      <span>{item.startTime}</span>
                      <span>{item.endTime}</span>
                    </div>
                    <div className="agenda-copy">
                      <h3>{item.label}</h3>
                      {item.energy && <span className="agenda-energy">{item.energy}</span>}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-card compact-empty">
                <h3>Sin compromisos fijos</h3>
                <p>Los bloques de tu horario aparecen aquí como contexto, no como tareas.</p>
              </div>
            )}
          </section>

          <section className="day-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Plan de trabajo</p>
                <h2>Lo que mueve el día</h2>
              </div>
              <span className="section-count">{taskCount} tareas</span>
            </div>

            {groupedTasks.length === 0 ? (
              <div className="empty-card">
                <div className="empty-icon"><Icon name="spark" size={20} /></div>
                <h3>No hay tareas para este día</h3>
                <p>Tu agenda está limpia. Puedes usar el agente MCP para preparar el siguiente movimiento.</p>
              </div>
            ) : (
              <div className="task-groups">
                {groupedTasks.map(([key, tasks]) => (
                  <div className="task-group" key={key}>
                    <div className="group-label"><span className="group-line" />{blockLabel(key === "none" ? null : key)}</div>
                    <div className="task-list">
                      {tasks.map((task) => (
                        <TaskRow key={task.id} busy={busyId === task.id} onComplete={() => void finishTask(task.id)} task={task} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="day-section habit-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Ritual protegido</p>
                <h2>Hábitos</h2>
              </div>
              <span className="section-count">{completedHabits}/{habitCount}</span>
            </div>
            {day?.habits.length ? (
              <div className="habit-list">
                {day.habits.map((habit) => (
                  <HabitRow
                    busy={busyId === habit.taskId}
                    habit={habit}
                    key={habit.taskId}
                    onComplete={(mode) => void finishTask(habit.taskId, mode)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-card compact-empty">
                <h3>Sin hábitos programados</h3>
                <p>Cuando configures tus rituales, aparecerán aquí sin competir con tus tareas.</p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
