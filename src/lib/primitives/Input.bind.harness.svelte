<script lang="ts">
  import Input from "./Input.svelte";

  let v = $state("seed");
</script>

<Input bind:value={v} />
<pre data-testid="bound">{v}</pre>
