<script lang="ts">
  import { Button, Mono, SLabel } from "../../lib/primitives";
  import { renderMarkdown } from "../../lib/render-markdown";

  interface Props {
    prompt: string;
    onSave: (next: string) => void | Promise<void>;
  }

  let { prompt, onSave }: Props = $props();

  let editing = $state(false);
  let draft = $state("");

  const wordCount = $derived(
    (editing ? draft : prompt).trim().split(/\s+/).filter(Boolean).length,
  );

  function startEdit() {
    draft = prompt;
    editing = true;
  }

  function cancelEdit() {
    editing = false;
  }

  async function save() {
    await onSave(draft);
    editing = false;
  }
</script>

<section class="flex flex-col gap-[10px]">
  {#if !editing}
    <div class="flex items-baseline gap-[10px]">
      <SLabel>System prompt</SLabel>
      <Mono size={10} color="var(--color-fg-disabled)">
        {#snippet children()}{wordCount} words{/snippet}
      </Mono>
      <div class="flex-1"></div>
      <Button variant="ghost" size="xs" onclick={startEdit}>
        {#snippet children()}Edit{/snippet}
      </Button>
    </div>
    <div
      class="border border-border-default rounded-[10px] bg-bg-elevated px-[20px] py-[18px] max-h-[220px] overflow-auto markdown"
    >
      {#if prompt === ""}
        <p class="text-fg-muted text-[13px] leading-[1.65] m-0">
          No system prompt. Click Edit to add one.
        </p>
      {:else}
        {@html renderMarkdown(prompt)}
      {/if}
    </div>
  {:else}
    <div class="border border-border-default rounded-[10px] bg-bg-elevated p-2">
      <textarea
        bind:value={draft}
        class="w-full min-h-[160px] resize-y bg-transparent outline-none font-[family-name:var(--font-ui)] text-[13px] leading-[1.65] text-fg-default p-2"
        placeholder="Write a system prompt…"
      ></textarea>
      <div class="flex justify-end gap-2 pt-2">
        <Button variant="ghost" size="xs" onclick={cancelEdit}>
          {#snippet children()}Cancel{/snippet}
        </Button>
        <Button variant="primary" size="xs" onclick={save}>
          {#snippet children()}Save{/snippet}
        </Button>
      </div>
    </div>
  {/if}
</section>
