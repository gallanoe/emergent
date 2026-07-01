import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ConfigPill from "./ConfigPill.svelte";
import type { ConfigOption } from "../../stores/types";

const modelConfig: ConfigOption = {
  id: "model",
  name: "Model",
  current_value: "sonnet",
  options: [
    { value: "sonnet", name: "Sonnet 4.6" },
    { value: "opus", name: "Opus 4.8" },
  ],
};

describe("ConfigPill", () => {
  it("shows the current value on the pill face, not the dimension name", () => {
    render(ConfigPill, {
      props: {
        config: modelConfig,
        open: false,
        onOpenChange: () => {},
        onSetConfig: () => {},
      },
    });
    const trigger = screen.getByRole("button", { name: /Sonnet 4\.6/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    // The dimension name only lives inside the (closed) popup.
    expect(screen.queryByText("Model")).toBeNull();
  });

  it("requests open when the closed pill is clicked", async () => {
    const onOpenChange = vi.fn();
    render(ConfigPill, {
      props: {
        config: modelConfig,
        open: false,
        onOpenChange,
        onSetConfig: () => {},
      },
    });
    await fireEvent.click(screen.getByRole("button", { name: /Sonnet 4\.6/i }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("renders a labelled menu with the dimension name and options when open", () => {
    render(ConfigPill, {
      props: {
        config: modelConfig,
        open: true,
        onOpenChange: () => {},
        onSetConfig: () => {},
      },
    });
    expect(screen.getByRole("menu", { name: "Model" })).toBeTruthy();
    expect(screen.getByText("Opus 4.8")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sonnet 4\.6/i }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    // The current selection is exposed as a checked menuitemradio.
    const current = screen.getByRole("menuitemradio", { name: "Sonnet 4.6" });
    expect(current.getAttribute("aria-checked")).toBe("true");
  });

  it("calls onSetConfig with (id, value) and requests close when an option is picked", async () => {
    const onSetConfig = vi.fn();
    const onOpenChange = vi.fn();
    render(ConfigPill, {
      props: { config: modelConfig, open: true, onOpenChange, onSetConfig },
    });
    await fireEvent.click(screen.getByText("Opus 4.8"));
    expect(onSetConfig).toHaveBeenCalledWith("model", "opus");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("requests close on Escape when open", async () => {
    const onOpenChange = vi.fn();
    render(ConfigPill, {
      props: { config: modelConfig, open: true, onOpenChange, onSetConfig: () => {} },
    });
    await fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("requests close on an outside pointer-down when open", async () => {
    const onOpenChange = vi.fn();
    render(ConfigPill, {
      props: { config: modelConfig, open: true, onOpenChange, onSetConfig: () => {} },
    });
    await fireEvent.mouseDown(document.body);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders grouped options with their group labels when open", () => {
    const grouped: ConfigOption = {
      id: "model",
      name: "Model",
      current_value: "sonnet",
      options: [
        {
          label: "Anthropic",
          options: [
            { value: "sonnet", name: "Sonnet 4.6" },
            { value: "opus", name: "Opus 4.8" },
          ],
        },
        { label: "Local", options: [{ value: "llama", name: "Llama" }] },
      ],
    };
    render(ConfigPill, {
      props: { config: grouped, open: true, onOpenChange: () => {}, onSetConfig: () => {} },
    });
    expect(screen.getByText("Anthropic")).toBeTruthy();
    expect(screen.getByText("Local")).toBeTruthy();
    expect(screen.getByText("Llama")).toBeTruthy();
  });
});
