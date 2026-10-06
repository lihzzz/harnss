import { JsonFileStore } from "../json-file-store";

interface MemorySecrets {
  llmApiKey?: string;
}

const store = new JsonFileStore<MemorySecrets>({
  subDir: "memory-secrets",
  encrypt: true,
  label: "MEMORY_SECRETS",
});

const KEY = "hindsight";

export function getMemoryLlmKey(): string | undefined {
  const value = store.load(KEY)?.llmApiKey;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function hasMemoryLlmKey(): boolean {
  return !!getMemoryLlmKey();
}

export function setMemoryLlmKey(key: string): void {
  const normalized = key.trim();
  if (!normalized) {
    clearMemoryLlmKey();
    return;
  }
  store.save(KEY, { llmApiKey: normalized });
}

export function clearMemoryLlmKey(): void {
  store.delete(KEY);
}
