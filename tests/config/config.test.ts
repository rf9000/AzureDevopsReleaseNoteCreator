import { describe, expect, it } from "bun:test";
import { loadConfig } from "../../src/config/index.ts";

/** Minimal valid env vars for a successful loadConfig call. */
const validEnv: Record<string, string> = {
  AZURE_DEVOPS_PAT: "test-pat-token",
  AZURE_DEVOPS_ORG: "my-org",
  AZURE_DEVOPS_PROJECT: "my-project",
  AZURE_DEVOPS_REPO_IDS: "repo1,repo2",
};

describe("loadConfig", () => {
  it("returns correct AppConfig for valid env", () => {
    const config = loadConfig(validEnv);

    expect(config.pat).toBe("test-pat-token");
    expect(config.org).toBe("my-org");
    expect(config.orgUrl).toBe("https://dev.azure.com/my-org");
    expect(config.project).toBe("my-project");
    expect(config.repoIds).toEqual(["repo1", "repo2"]);
  });

  it("throws when AZURE_DEVOPS_PAT is missing", () => {
    const env = { ...validEnv };
    delete env.AZURE_DEVOPS_PAT;

    expect(() => loadConfig(env)).toThrow("Invalid configuration");
  });

  it("throws when AZURE_DEVOPS_ORG is missing", () => {
    const env = { ...validEnv };
    delete env.AZURE_DEVOPS_ORG;

    expect(() => loadConfig(env)).toThrow("Invalid configuration");
  });

  it("throws when AZURE_DEVOPS_PROJECT is missing", () => {
    const env = { ...validEnv };
    delete env.AZURE_DEVOPS_PROJECT;

    expect(() => loadConfig(env)).toThrow("Invalid configuration");
  });

  it("throws when AZURE_DEVOPS_REPO_IDS is missing", () => {
    const env = { ...validEnv };
    delete env.AZURE_DEVOPS_REPO_IDS;

    expect(() => loadConfig(env)).toThrow("Invalid configuration");
  });

  it("applies default values when optional vars are absent", () => {
    const config = loadConfig(validEnv);

    expect(config.releaseNotesField).toBe("Custom.ReleaseNotes");
    expect(config.pollIntervalMinutes).toBe(25);
    expect(config.claudeModel).toBe("claude-opus-4-6");
    expect(config.releaseNotePromptPath).toBe(".claude/commands/do-CreateReleaseNoteContinia.md");
    expect(config.stateDir).toBe(".state");
    expect(config.assignedToFilter).toBeNull();
    expect(config.lookbackDays).toBe(7);
  });

  it("overrides defaults when optional vars are provided", () => {
    const env = {
      ...validEnv,
      RELEASE_NOTES_FIELD: "System.Description",
      POLL_INTERVAL_MINUTES: "30",
      CLAUDE_MODEL: "claude-opus-4-6",
      RELEASE_NOTE_PROMPT_PATH: "custom/prompt.md",
      STATE_DIR: "/tmp/state",
      ASSIGNED_TO_FILTER: "René Frandsen",
      LOOKBACK_DAYS: "14",
    };

    const config = loadConfig(env);

    expect(config.releaseNotesField).toBe("System.Description");
    expect(config.pollIntervalMinutes).toBe(30);
    expect(config.claudeModel).toBe("claude-opus-4-6");
    expect(config.releaseNotePromptPath).toBe("custom/prompt.md");
    expect(config.stateDir).toBe("/tmp/state");
    expect(config.assignedToFilter).toBe("René Frandsen");
    expect(config.lookbackDays).toBe(14);
  });

  it("splits repo IDs and trims whitespace", () => {
    const env = {
      ...validEnv,
      AZURE_DEVOPS_REPO_IDS: "id1, id2, id3",
    };

    const config = loadConfig(env);

    expect(config.repoIds).toEqual(["id1", "id2", "id3"]);
  });

  it("handles single repo ID without commas", () => {
    const env = {
      ...validEnv,
      AZURE_DEVOPS_REPO_IDS: "single-repo",
    };

    const config = loadConfig(env);

    expect(config.repoIds).toEqual(["single-repo"]);
  });

  it("derives orgUrl from org name", () => {
    const env = {
      ...validEnv,
      AZURE_DEVOPS_ORG: "contoso",
    };

    const config = loadConfig(env);

    expect(config.orgUrl).toBe("https://dev.azure.com/contoso");
  });
});
