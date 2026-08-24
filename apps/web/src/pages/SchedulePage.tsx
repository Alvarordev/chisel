import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ScheduleBlock } from "@chisel/contracts";
import { ApiError, getSchedule, putSchedule, type ScheduleBlockInput } from "../lib/api";
import { Icon } from "../components/Icon";

const DAY_NAMES = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const STATE_LABELS: Record<ScheduleBlockInput["state"], string> = {
  busy: "Ocupado",
  free: "Libre",
  porous: "Poroso",
};

function todayIso(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

type DraftBlock = ScheduleBlockInput & { key: string };

function toDraft(block: ScheduleBlock): DraftBlock {
  return {
    key: block.id,
    id: block.id,
    label: block.label,
    dayOfWeek: block.dayOfWeek,
    startTime: block.startTime,
    endTime: block.endTime,
    state: block.state,
    energy: block.energy,
  };
}

export function SchedulePage() {
  const [blocks, setBlocks] = useState<DraftBlock[]>([]);
  const [validFrom, setValidFrom] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("10:00");
  const [state, setState] = useState<ScheduleBlockInput["state"]>("busy");
  const [energy, setEnergy] = useState<"deep" | "shallow" | "">("");

  useEffect(() => {
    getSchedule()
      .then((schedule) => {
        setBlocks(schedule.blocks.map(toDraft));
        setValidFrom(schedule.validFrom);
      })
      .catch(() => setError("No pudimos cargar tu horario."))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<number, DraftBlock[]>();
    for (let day = 1; day <= 7; day += 1) map.set(day, []);
    for (const block of blocks) {
      map.set(block.dayOfWeek, [...(map.get(block.dayOfWeek) ?? []), block]);
    }
    for (const [day, dayBlocks] of map) {
      map.set(day, dayBlocks.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    }
    return map;
  }, [blocks]);

  function addBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBlocks((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        label: label.trim(),
        dayOfWeek,
        startTime,
        endTime,
        state,
        energy: energy || null,
      },
    ]);
    setLabel("");
  }

  function removeBlock(key: string) {
    setBlocks((current) => current.filter((block) => block.key !== key));
  }

  async function saveSchedule() {
    if (blocks.length === 0) {
      setError("Agregá al menos un bloque antes de guardar.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await putSchedule({
        validFrom: todayIso(),
        blocks: blocks.map(({ key: _key, ...block }) => block),
      });
      setValidFrom(result.validFrom);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No pudimos guardar el horario.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-wrap">
      <header className="page-header">
        <div>
          <p className="eyebrow">Compromisos fijos</p>
          <h1>Horario</h1>
          <p className="page-lede">Clases, trabajo y bloques que el planificador debe respetar.</p>
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
                <p className="eyebrow">Plantilla vigente</p>
                <h2>Semana actual</h2>
              </div>
              {validFrom && <span className="section-count">desde {validFrom}</span>}
            </div>

            {blocks.length === 0 ? (
              <div className="empty-card">
                <h3>Sin bloques todavía</h3>
                <p>Agregá clases, trabajo u otros compromisos fijos.</p>
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
                          <article className="schedule-block-card" key={block.key}>
                            <div className="schedule-block-main">
                              <strong>{block.label}</strong>
                              <span>{block.startTime} – {block.endTime}</span>
                              <span className={`schedule-state state-${block.state}`}>{STATE_LABELS[block.state]}</span>
                              {block.energy && <span className="schedule-energy">{block.energy}</span>}
                            </div>
                            <button
                              aria-label={`Quitar ${block.label}`}
                              className="icon-button subtle"
                              onClick={() => removeBlock(block.key)}
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

            <button className="primary-button wide-button" disabled={saving || blocks.length === 0} onClick={() => void saveSchedule()} type="button">
              {saving ? "Guardando..." : "Guardar plantilla"}
            </button>
          </section>

          <section className="schedule-form-panel">
            <p className="eyebrow">Nuevo bloque</p>
            <h2>Agregar compromiso</h2>
            <form className="project-form schedule-form" onSubmit={addBlock}>
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
                <span>Estado</span>
                <select onChange={(event) => setState(event.target.value as ScheduleBlockInput["state"])} value={state}>
                  <option value="busy">Ocupado</option>
                  <option value="free">Libre</option>
                  <option value="porous">Poroso</option>
                </select>
              </label>
              <label>
                <span>Energía <em>Opcional</em></span>
                <select onChange={(event) => setEnergy(event.target.value as "" | "deep" | "shallow")} value={energy}>
                  <option value="">Sin definir</option>
                  <option value="deep">Deep</option>
                  <option value="shallow">Shallow</option>
                </select>
              </label>
              <button className="secondary-button wide-button" type="submit">
                Agregar bloque
                <Icon name="plus" size={17} />
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
