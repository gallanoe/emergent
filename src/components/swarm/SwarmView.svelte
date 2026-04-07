<script lang="ts">
  import type { DisplayWorkspace } from "../../stores/types";
  interface Props {
    swarm: DisplayWorkspace;
    agentConnections: Record<string, string[]>;
    demoMode: boolean;
    onSelectAgent: (id: string) => void;
  }

  let { swarm, agentConnections, demoMode, onSelectAgent }: Props = $props();
</script>

<div class="flex flex-col h-full min-h-0">
  <!-- Agent definitions are shown via InnerSidebar; this view is a placeholder -->
</div>
