<script lang="ts">
  import type { Component } from "svelte";
  import {
    FileText,
    Pencil,
    Trash2,
    ArrowRightLeft,
    Search,
    SquareTerminal,
    Brain,
    Globe,
    Wrench,
  } from "@lucide/svelte";
  import type { ToolKind } from "../../stores/types";

  interface Props {
    kind: ToolKind;
    size?: number;
    class?: string;
  }

  let { kind, size = 12, class: klass = "" }: Props = $props();

  // Map each ACP ToolKind to a Lucide icon. `other` falls back to a wrench.
  const ICONS: Record<ToolKind, Component> = {
    read: FileText,
    edit: Pencil,
    delete: Trash2,
    move: ArrowRightLeft,
    search: Search,
    execute: SquareTerminal,
    think: Brain,
    fetch: Globe,
    other: Wrench,
  };

  let Icon = $derived(ICONS[kind] ?? Wrench);
</script>

<Icon {size} class={klass} aria-hidden="true" />
