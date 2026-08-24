import {
  dayResponseSchema,
  profileSchema,
  projectDetailSchema,
  projectSchema,
  scheduleResponseSchema,
  type AgentStyle,
  type DayHabit,
  type DayResponse,
  type Profile,
  type Project,
  type ProjectDetail,
  type ScheduleBlock,
  type ScheduleResponse,
  type Task,
} from "@chisel/contracts";

export type AuthSession = {
  session: {
    id: string;
    userId: string;
    expiresAt: string;
  };
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class UnauthorizedError extends ApiError {
  constructor() {
    super("Tu sesión ha terminado.", 401);
    this.name = "UnauthorizedError";
  }
}

async function responseData(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(data: unknown, fallback: string): string {
  if (typeof data === "object" && data !== null && "error" in data) {
    const error = data.error;
    if (typeof error === "string") return error;
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
      return error.message;
    }
  }

  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (init.body && !isFormData && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });
  const data = await responseData(response);

  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new ApiError(errorMessage(data, `Request failed (${response.status})`), response.status);
  return data as T;
}

export async function getSession(): Promise<AuthSession | null> {
  const response = await fetch("/api/auth/get-session", { credentials: "include" });
  if (response.status === 401) return null;
  if (!response.ok) throw new ApiError("No se pudo comprobar la sesión.", response.status);

  const data = await responseData(response);
  if (typeof data !== "object" || data === null || !("user" in data) || !("session" in data)) return null;
  return data as AuthSession;
}

export async function signIn(email: string, password: string): Promise<void> {
  await request("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password, rememberMe: true }),
  });
}

export async function signOut(): Promise<void> {
  await request("/api/auth/sign-out", { method: "POST", body: JSON.stringify({}) });
}

export async function getDay(date: string): Promise<DayResponse> {
  return dayResponseSchema.parse(await request(`/api/day/${date}`));
}

export async function completeTask(
  taskId: string,
  input: { completionMode?: "full" | "floor"; itemIds?: string[] } = {},
): Promise<Task | DayHabit> {
  return request(`/api/tasks/${encodeURIComponent(taskId)}/complete`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getProjects(): Promise<Project[]> {
  const data = await request<unknown>("/api/projects");
  return Array.isArray(data) ? data.map((project) => projectSchema.parse(project)) : [];
}

export async function createProject(input: {
  name: string;
  kind: "build" | "study";
  deadline?: string | null;
}): Promise<Project> {
  return projectSchema.parse(await request("/api/projects", {
    method: "POST",
    body: JSON.stringify(input),
  }));
}

export async function getProject(id: string): Promise<ProjectDetail> {
  return projectDetailSchema.parse(await request(`/api/projects/${encodeURIComponent(id)}`));
}

export async function setProjectDocument(
  projectId: string,
  input: {
    type: "spec" | "approach";
    content: string;
    summary?: string | null;
    previewId?: string;
  },
): Promise<{ id: string; updatedAt: string }> {
  return request(`/api/projects/${encodeURIComponent(projectId)}/documents`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function uploadProjectDocument(
  projectId: string,
  input: { type: "spec" | "approach"; file: File },
): Promise<{
  previewId: string;
  type: "spec" | "approach";
  markdown: string;
  warnings: string[];
  originalName: string;
}> {
  const body = new FormData();
  body.set("type", input.type);
  body.set("file", input.file);
  return request(`/api/projects/${encodeURIComponent(projectId)}/documents/upload`, {
    method: "POST",
    body,
  });
}

export async function getSchedule(asOf?: string): Promise<ScheduleResponse> {
  const query = asOf ? `?asOf=${encodeURIComponent(asOf)}` : "";
  return scheduleResponseSchema.parse(await request(`/api/schedule${query}`));
}

export type ScheduleBlockInput = {
  label: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  state: "busy" | "free" | "porous";
  energy?: "deep" | "shallow" | null;
  validFrom?: string;
  validUntil?: string | null;
};

export async function createScheduleBlock(input: ScheduleBlockInput): Promise<ScheduleBlock> {
  return request("/api/schedule/blocks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateScheduleBlock(
  id: string,
  input: Partial<ScheduleBlockInput>,
): Promise<ScheduleBlock> {
  return request(`/api/schedule/blocks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteScheduleBlock(id: string): Promise<ScheduleBlock> {
  return request(`/api/schedule/blocks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function getProfile(): Promise<Profile> {
  return profileSchema.parse(await request("/api/profile"));
}

export async function updateProfile(input: { agentStyle?: AgentStyle }): Promise<Profile> {
  return profileSchema.parse(await request("/api/profile", {
    method: "PATCH",
    body: JSON.stringify(input),
  }));
}
