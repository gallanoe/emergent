<script lang="ts">
  import {
    FileText,
    Pencil,
    Trash2,
    ArrowRightLeft,
    Search,
    SquareTerminal,
    Sparkles,
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

  const ICON_BY_KIND = {
    read: FileText,
    edit: Pencil,
    delete: Trash2,
    move: ArrowRightLeft,
    search: Search,
    execute: SquareTerminal,
    think: Sparkles,
    fetch: Globe,
    other: Wrench,
  } as const;

  let Icon = $derived(ICON_BY_KIND[kind]);
</script>

<Icon {size} class={klass} aria-hidden="true" />
