import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ScheduleBlock } from "@chisel/contracts";
import { ApiError, createScheduleBlock, deleteScheduleBlock, getSchedule } from "../lib/api";
import { Icon } from "../components/Icon";

const DAY_NAMES = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

type ValidityMode = "indefinite" | "until" | "duration";
type DurationUnit = "days" | "weeks" | "months";

function todayIso(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function addDuration(from: string, amount: number, unit: DurationUnit): string {
  const date = new Date(`${from}T12:00:00`);
  if (unit === "days") date.setDate(date.getDate() + amount);
  if (unit === "weeks") date.setDate(date.getDate() + amount * 7);
  if (unit === "months") date.setMonth(date.getMonth() + amount);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatValidity(block: ScheduleBlock): string {
  if (!block.validUntil) return "Indefinido";
  return `Hasta ${block.validUntil}`;
}

function computeValidUntil(
  validFrom: string,
  mode: ValidityMode,
  validUntil: string,
  durationAmount: number,
  durationUnit: DurationUnit,
): string | null {
  if (mode === "indefinite") return null;
  if (mode === "until") return validUntil || null;
  if (durationAmount <= 0) return null;
  return addDuration(validFrom, durationAmount, durationUnit);
}

export function SchedulePage() {
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("10:00");
  const [validFrom, setValidFrom] = useState(todayIso());
  const [validityMode, setValidityMode] = useState<ValidityMode>("until");
  const [validUntil, setValidUntil] = useState("");
  const [durationAmount, setDurationAmount] = useState(16);
  const [durationUnit, setDurationUnit] = useState<DurationUnit>("weeks");

  async function loadBlocks() {
    const schedule = await getSchedule();
    setBlocks(schedule.blocks);
  }

  useEffect(() => {
    loadBlocks()
      .catch(() => setError("No pudimos cargar tu horario."))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<number, ScheduleBlock[]>();
    for (let day = 1; day <= 7; day += 1) map.set(day, []);
    for (const block of blocks) {
      map.set(block.dayOfWeek, [...(map.get(block.dayOfWeek) ?? []), block]);
    }
    for (const [day, dayBlocks] of map) {
      map.set(day, dayBlocks.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    }
    return map;
  }, [blocks]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await createScheduleBlock({
        label: label.trim(),
        dayOfWeek,
        startTime,
        endTime,
        state: "busy",
        validFrom,
        validUntil: computeValidUntil(validFrom, validityMode, validUntil, durationAmount, durationUnit),
      });
      await loadBlocks();
      setLabel("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No pudimos guardar el compromiso.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    setError("");
    try {
      await deleteScheduleBlock(id);
      await loadBlocks();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No pudimos quitar el compromiso.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="page-wrap">
      <header className="page-header">
        <div>
          <p className="eyebrow">Compromisos fijos</p>
          <h1>Horario</h1>
          <p className="page-lede">Clases, judo y bloques a los que asistís. Son contexto para el planificador, no tareas para marcar.</p>
        </div>
        <div className="header-symbol"><Icon name="calendar" size={24} /></div>
      </header>

      {error && <div className="inline-error" role="alert">{error}</div>}

      {loading ? (
        <div className="loading-stack"><div className="skeleton skeleton-large" /><div className="skeleton" /></div>
      ) : (
        <div className="schedule-layout">
          <section className="schedule-week-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Solo lectura en Hoy</p>
                <h2>Compromisos activos</h2>
              </div>
              <span className="section-count">{blocks.length}</span>
            </div>

            {blocks.length === 0 ? (
              <div className="empty-card">
                <h3>Sin compromisos todavía</h3>
                <p>Agregá clases, judo o trabajo con su fecha de fin cuando corresponda.</p>
              </div>
            ) : (
              <div className="schedule-week">
                {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                  <div className="schedule-day" key={day}>
                    <h3>{DAY_NAMES[day]}</h3>
                    {(grouped.get(day) ?? []).length === 0 ? (
                      <p className="schedule-empty-day">Sin bloques</p>
                    ) : (
                      <div className="schedule-block-list">
                        {(grouped.get(day) ?? []).map((block) => (
                          <article className="schedule-block-card" key={block.id}>
                            <div className="schedule-block-main">
                              <strong>{block.label}</strong>
                              <span>{block.startTime} – {block.endTime}</span>
                              <span className="schedule-validity">{formatValidity(block)}</span>
                            </div>
                            <button
                              aria-label={`Finalizar ${block.label}`}
                              className="icon-button subtle"
                              disabled={removingId === block.id}
                              onClick={() => void handleRemove(block.id)}
                              type="button"
                            >
                              ×
                            </button>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="schedule-form-panel">
            <p className="eyebrow">Nuevo compromiso</p>
            <h2>Agregar al horario</h2>
            <p className="panel-lede schedule-note">No aparece como to-do. El agente lo usa para calcular cuánto podés avanzar.</p>
            <form className="project-form schedule-form" onSubmit={(event) => void handleCreate(event)}>
              <label>
                <span>Nombre</span>
                <input onChange={(event) => setLabel(event.target.value)} placeholder="Ej. Progra Web" required value={label} />
              </label>
              <label>
                <span>Día</span>
                <select onChange={(event) => setDayOfWeek(Number(event.target.value))} value={dayOfWeek}>
                  {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                    <option key={day} value={day}>{DAY_NAMES[day]}</option>
                  ))}
                </select>
              </label>
              <div className="schedule-time-row">
                <label>
                  <span>Desde</span>
                  <input onChange={(event) => setStartTime(event.target.value)} required type="time" value={startTime} />
                </label>
                <label>
                  <span>Hasta</span>
                  <input onChange={(event) => setEndTime(event.target.value)} required type="time" value={endTime} />
                </label>
              </div>
              <label>
                <span>Empieza</span>
                <input onChange={(event) => setValidFrom(event.target.value)} required type="date" value={validFrom} />
              </label>
              <label>
                <span>Vigencia</span>
                <select onChange={(event) => setValidityMode(event.target.value as ValidityMode)} value={validityMode}>
                  <option value="until">Hasta una fecha</option>
                  <option value="duration">Por duración</option>
                  <option value="indefinite">Indefinido</option>
                </select>
              </label>
              {validityMode === "until" && (
                <label>
                  <span>Hasta</span>
                  <input onChange={(event) => setValidUntil(event.target.value)} required type="date" value={validUntil} />
                </label>
              )}
              {validityMode === "duration" && (
                <div className="schedule-time-row">
                  <label>
                    <span>Cantidad</span>
                    <input
                      min={1}
                      onChange={(event) => setDurationAmount(Number(event.target.value))}
                      required
                      type="number"
                      value={durationAmount}
                    />
                  </label>
                  <label>
                    <span>Unidad</span>
                    <select onChange={(event) => setDurationUnit(event.target.value as DurationUnit)} value={durationUnit}>
                      <option value="days">Días</option>
                      <option value="weeks">Semanas</option>
                      <option value="months">Meses</option>
                    </select>
                  </label>
                </div>
              )}
              <button className="primary-button wide-button" disabled={saving} type="submit">
                {saving ? "Guardando..." : "Guardar compromiso"}
                {!saving && <Icon name="plus" size={17} />}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
