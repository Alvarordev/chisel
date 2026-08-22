export type ActorSource = "agent" | "web";
export type AgentClient = "claude" | "chatgpt" | "gemini" | null;

export type ActorContext = {
  userId: string;
  source: ActorSource;
  agentClient: AgentClient;
};
