import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ConfigPopover from "./ConfigPopover.svelte";
import type { ConfigOption } from "../../stores/types";

function flatOpt(
  id: string,
  name: string,
  category: string | undefined,
  current = "a",
): ConfigOption {
  const base: ConfigOption = {
    id,
    name,
    current_value: current,
    options: [
      { value: "a", name: "Option A" },
      { value: "b", name: "Option B" },
    ],
  };
  return category !== undefined ? { ...base, category } : base;
}

describe("ConfigPopover", () => {
  it("renders all config names", () => {
    const configs = [
      flatOpt("c1", "Model", "Runtime"),
      flatOpt("c2", "Reasoning", "Runtime"),
      flatOpt("c3", "Tools", undefined),
    ];
    render(ConfigPopover, {
      props: {
        configs,
        onSetConfig: () => {},
        onClose: () => {},
      },
    });
    expect(screen.getByText("Model")).toBeTruthy();
    expect(screen.getByText("Reasoning")).toBeTruthy();
    expect(screen.getByText("Tools")).toBeTruthy();
  });

  it("calls onSetConfig and onClose when an option is selected", async () => {
    const onSetConfig = vi.fn();
    const onClose = vi.fn();
    const configs = [flatOpt("c1", "Model", undefined, "a")];
    render(ConfigPopover, {
      props: { configs, onSetConfig, onClose },
    });
    await fireEvent.click(screen.getByText("Model"));
    await fireEvent.click(screen.getByText("Option B"));
    expect(onSetConfig).toHaveBeenCalledWith("c1", "b");
    expect(onClose).toHaveBeenCalled();
  });
});
