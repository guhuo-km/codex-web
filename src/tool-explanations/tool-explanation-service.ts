import type { TitleGenerationService } from "../title-generation/title-generation-service.js";
import type { ToolExplanationIdentity, ToolExplanationStore } from "./tool-explanation-store.js";

export class ToolExplanationService {
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly store: ToolExplanationStore,
    private readonly titleGeneration: TitleGenerationService
  ) {}

  async explain(input: ToolExplanationIdentity): Promise<string> {
    const cached = await this.store.get(input);
    if (cached) return cached;

    const key = explanationKey(input);
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const pending = this.titleGeneration.explainCommand({ command: input.command })
      .then(async (explanation) => {
        await this.store.set(input, explanation);
        return explanation;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, pending);
    return pending;
  }

  annotate(input: unknown): Promise<unknown> {
    return this.store.annotate(input);
  }
}

function explanationKey(input: ToolExplanationIdentity): string {
  return `${input.threadId}\n${input.turnId}\n${input.toolCallId}\n${input.command.trim()}`;
}
