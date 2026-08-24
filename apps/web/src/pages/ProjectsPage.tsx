import { useEffect, useState, type FormEvent } from "react";
import type { Project, ProjectDocument } from "@chisel/contracts";
import { ApiError, createProject, getProject, getProjects, setProjectDocument } from "../lib/api";
import { Icon } from "../components/Icon";

function projectProgress(project: Project): number {
  const total = project.pendingTasks + project.completedTasks;
  return total === 0 ? 0 : Math.round((project.completedTasks / total) * 100);
}

function documentContent(documents: ProjectDocument[], type: "spec" | "approach"): string {
  return documents.find((doc) => doc.type === type)?.content ?? "";
}

function documentSummary(documents: ProjectDocument[], type: "spec" | "approach"): string {
  return documents.find((doc) => doc.type === type)?.summary ?? "";
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [spec, setSpec] = useState("");
  const [approach, setApproach] = useState("");
  const [specSummary, setSpecSummary] = useState("");
  const [approachSummary, setApproachSummary] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [savingDoc, setSavingDoc] = useState<"spec" | "approach" | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"build" | "study">("build");
  const [deadline, setDeadline] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    getProjects()
      .then(setProjects)
      .catch(() => setError("No pudimos cargar tus proyectos."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setDetailLoading(true);
    getProject(selectedId)
      .then((detail) => {
        setSpec(documentContent(detail.documents, "spec"));
        setApproach(documentContent(detail.documents, "approach"));
        setSpecSummary(documentSummary(detail.documents, "spec"));
        setApproachSummary(documentSummary(detail.documents, "approach"));
      })
      .catch(() => setError("No pudimos cargar el proyecto."))
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      const project = await createProject({ name, kind, deadline: deadline || null });
      setProjects((current) => [...current, project]);
      setSelectedId(project.id);
      setName("");
      setDeadline("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No pudimos crear el proyecto.");
    } finally {
      setCreating(false);
    }
  }

  async function saveDocument(type: "spec" | "approach") {
    if (!selectedId) return;
    setSavingDoc(type);
    setError("");
    try {
      await setProjectDocument(selectedId, {
        type,
        content: type === "spec" ? spec : approach,
        summary: type === "spec" ? specSummary || null : approachSummary || null,
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No pudimos guardar el documento.");
    } finally {
      setSavingDoc(null);
    }
  }

  const selected = projects.find((project) => project.id === selectedId);

  return (
    <div className="page-wrap">
      <header className="page-header">
        <div>
          <p className="eyebrow">Contexto que permanece</p>
          <h1>Proyectos</h1>
          <p className="page-lede">Un lugar para guardar por qué importa cada cosa.</p>
        </div>
        <div className="header-symbol"><Icon name="layers" size={24} /></div>
      </header>

      {error && <div className="inline-error" role="alert">{error}</div>}

      <div className="projects-layout">
        <section className="project-list-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Activos</p>
              <h2>En movimiento</h2>
            </div>
            <span className="section-count">{projects.length}</span>
          </div>

          {loading ? (
            <div className="loading-stack"><div className="skeleton" /><div className="skeleton" /></div>
          ) : projects.length === 0 ? (
            <div className="empty-card project-empty">
              <div className="empty-icon"><Icon name="plus" size={20} /></div>
              <h3>Aún no hay proyectos</h3>
              <p>Empieza por algo que quieras construir o estudiar de verdad.</p>
            </div>
          ) : (
            <div className="project-list">
              {projects.map((project) => {
                const progress = projectProgress(project);
                const isSelected = project.id === selectedId;
                return (
                  <button
                    className={`project-card project-card-button${isSelected ? " is-selected" : ""}`}
                    key={project.id}
                    onClick={() => setSelectedId(project.id)}
                    type="button"
                  >
                    <div className={`project-type type-${project.kind}`}>
                      {project.kind === "build" ? "Build" : "Study"}
                    </div>
                    <div className="project-card-main">
                      <div className="project-title-line">
                        <h3>{project.name}</h3>
                        {project.deadline && <span className="project-deadline">{project.deadline}</span>}
                      </div>
                      <div className="project-progress-line">
                        <span>{project.completedTasks} completadas</span>
                        <span>{project.pendingTasks} pendientes</span>
                      </div>
                      <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
                    </div>
                    <span className="project-percent">{progress}%</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="create-project-panel">
          {selected ? (
            <>
              <p className="eyebrow">Documentos</p>
              <h2>{selected.name}</h2>
              <p className="panel-lede">Pegá el spec y el approach para que el agente planifique con contexto.</p>
              {detailLoading ? (
                <div className="loading-stack"><div className="skeleton" /><div className="skeleton" /></div>
              ) : (
                <div className="document-forms">
                  <div className="document-form">
                    <label>
                      <span>Spec <em>Qué se pide</em></span>
                      <textarea
                        onChange={(event) => setSpec(event.target.value)}
                        placeholder="Enunciado, requerimientos, PDF pegado..."
                        rows={8}
                        value={spec}
                      />
                    </label>
                    <label>
                      <span>Resumen <em>Opcional</em></span>
                      <input
                        onChange={(event) => setSpecSummary(event.target.value)}
                        placeholder="Resumen corto para documentos largos"
                        value={specSummary}
                      />
                    </label>
                    <button
                      className="secondary-button wide-button"
                      disabled={savingDoc === "spec" || !spec.trim()}
                      onClick={() => void saveDocument("spec")}
                      type="button"
                    >
                      {savingDoc === "spec" ? "Guardando..." : "Guardar spec"}
                    </button>
                  </div>
                  <div className="document-form">
                    <label>
                      <span>Approach <em>Cómo lo vas a hacer</em></span>
                      <textarea
                        onChange={(event) => setApproach(event.target.value)}
                        placeholder="Stack, convenciones, scripted actions..."
                        rows={8}
                        value={approach}
                      />
                    </label>
                    <label>
                      <span>Resumen <em>Opcional</em></span>
                      <input
                        onChange={(event) => setApproachSummary(event.target.value)}
                        placeholder="Resumen corto"
                        value={approachSummary}
                      />
                    </label>
                    <button
                      className="secondary-button wide-button"
                      disabled={savingDoc === "approach" || !approach.trim()}
                      onClick={() => void saveDocument("approach")}
                      type="button"
                    >
                      {savingDoc === "approach" ? "Guardando..." : "Guardar approach"}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="eyebrow">Nuevo contexto</p>
              <h2>¿Qué estás construyendo?</h2>
              <p className="panel-lede">Los proyectos ayudan al agente a tomar mejores decisiones cuando planifica tu día.</p>
              <form className="project-form" onSubmit={handleSubmit}>
                <label>
                  <span>Nombre del proyecto</span>
                  <input onChange={(event) => setName(event.target.value)} placeholder="Ej. Lanzar la app" required value={name} />
                </label>
                <label>
                  <span>Tipo</span>
                  <select onChange={(event) => setKind(event.target.value as "build" | "study")} value={kind}>
                    <option value="build">Construir</option>
                    <option value="study">Estudiar</option>
                  </select>
                </label>
                <label>
                  <span>Fecha objetivo <em>Opcional</em></span>
                  <input onChange={(event) => setDeadline(event.target.value)} type="date" value={deadline} />
                </label>
                <button className="primary-button wide-button" disabled={creating} type="submit">
                  {creating ? "Guardando..." : "Crear proyecto"}
                  {!creating && <Icon name="plus" size={17} />}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
