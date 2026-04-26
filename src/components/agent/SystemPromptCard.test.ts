import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import SystemPromptCard from "./SystemPromptCard.svelte";

describe("SystemPromptCard", () => {
  it("shows rendered prompt and word count in read mode", () => {
    render(SystemPromptCard, {
      props: {
        prompt: "alpha beta gamma",
        onSave: vi.fn(),
      },
    });
    expect(screen.getByText("3 words")).toBeTruthy();
    expect(screen.getByText(/alpha beta gamma/)).toBeTruthy();
  });

  it("shows placeholder when prompt is empty", () => {
    render(SystemPromptCard, {
      props: { prompt: "", onSave: vi.fn() },
    });
    expect(screen.getByText("No system prompt. Click Edit to add one.")).toBeTruthy();
    expect(screen.getByText("0 words")).toBeTruthy();
  });

  it("edit mode shows textarea seeded from prompt", async () => {
    render(SystemPromptCard, {
      props: {
        prompt: "seed line",
        onSave: vi.fn(),
      },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("seed line");
  });

  it("Save calls onSave with draft and returns to read mode", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(SystemPromptCard, {
      props: { prompt: "old", onSave },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    await fireEvent.input(ta, { target: { value: "new prompt text" } });
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("new prompt text");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("Cancel leaves read mode without calling onSave", async () => {
    const onSave = vi.fn();
    render(SystemPromptCard, {
      props: { prompt: "unchanged", onSave },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    await fireEvent.input(ta, { target: { value: "draft only" } });
    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
