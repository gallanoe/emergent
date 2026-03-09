import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AgentInspection,
  AgentSession,
  CostBreakdown,
  LiveTokenUsage,
  MailMessage,
  MergeEntry,
  MetricsSummary,
  OvConfig,
  Run,
  StatusOverview,
  StoredEvent,
  Workspace,
} from "@emergent/contracts";
import { wsClient } from "./use-ws";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const queryKeys = {
  workspaces: ["workspaces"] as const,
  agents: (wId: string) => ["agents", wId] as const,
  agentInspection: (name: string, wId: string) =>
    ["agentInspection", wId, name] as const,
  events: (wId: string, filters?: unknown) =>
    ["events", wId, filters] as const,
  mail: (wId: string, filters?: unknown) => ["mail", wId, filters] as const,
  mergeQueue: (wId: string) => ["mergeQueue", wId] as const,
  metrics: (wId: string) => ["metrics", wId] as const,
  liveTokens: (wId: string) => ["liveTokens", wId] as const,
  costs: (wId: string, filters?: unknown) =>
    ["costs", wId, filters] as const,
  runs: (wId: string) => ["runs", wId] as const,
  currentRun: (wId: string) => ["currentRun", wId] as const,
  config: (wId: string) => ["config", wId] as const,
  statusOverview: (wId: string) => ["statusOverview", wId] as const,
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function rpc<T>(method: string, params?: unknown) {
  return wsClient.sendRpc(method as Parameters<typeof wsClient.sendRpc>[0], params) as Promise<T>;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useWorkspaces() {
  return useQuery<Workspace[]>({
    queryKey: queryKeys.workspaces,
    queryFn: () => rpc<Workspace[]>("workspace.list"),
  });
}

export function useAgents(workspaceId: string | null) {
  return useQuery<AgentSession[]>({
    queryKey: queryKeys.agents(workspaceId!),
    queryFn: () => rpc<AgentSession[]>("agents.list", { workspaceId }),
    enabled: !!workspaceId,
    refetchInterval: 30_000,
  });
}

export function useAgentInspection(
  agentName: string | null,
  workspaceId: string | null,
) {
  return useQuery<AgentInspection>({
    queryKey: queryKeys.agentInspection(agentName!, workspaceId!),
    queryFn: () =>
      rpc<AgentInspection>("agents.inspect", {
        name: agentName,
        workspaceId,
      }),
    enabled: !!agentName && !!workspaceId,
  });
}

export function useEvents(
  filters: Record<string, unknown> | undefined,
  workspaceId: string | null,
) {
  return useQuery<StoredEvent[]>({
    queryKey: queryKeys.events(workspaceId!, filters),
    queryFn: () =>
      rpc<StoredEvent[]>("events.query", { ...filters, workspaceId }),
    enabled: !!workspaceId,
  });
}

export function useMailMessages(
  filters: Record<string, unknown> | undefined,
  workspaceId: string | null,
) {
  return useQuery<MailMessage[]>({
    queryKey: queryKeys.mail(workspaceId!, filters),
    queryFn: () =>
      rpc<MailMessage[]>("mail.list", { ...filters, workspaceId }),
    enabled: !!workspaceId,
  });
}

export function useMergeQueue(workspaceId: string | null) {
  return useQuery<MergeEntry[]>({
    queryKey: queryKeys.mergeQueue(workspaceId!),
    queryFn: () => rpc<MergeEntry[]>("merge.queue", { workspaceId }),
    enabled: !!workspaceId,
  });
}

export function useMetrics(workspaceId: string | null) {
  return useQuery<MetricsSummary>({
    queryKey: queryKeys.metrics(workspaceId!),
    queryFn: () => rpc<MetricsSummary>("metrics.summary", { workspaceId }),
    enabled: !!workspaceId,
  });
}

export function useLiveTokens(workspaceId: string | null) {
  return useQuery<LiveTokenUsage[]>({
    queryKey: queryKeys.liveTokens(workspaceId!),
    queryFn: () =>
      rpc<LiveTokenUsage[]>("metrics.live", { workspaceId }),
    enabled: !!workspaceId,
  });
}

export function useCosts(
  filters: Record<string, unknown> | undefined,
  workspaceId: string | null,
) {
  return useQuery<CostBreakdown>({
    queryKey: queryKeys.costs(workspaceId!, filters),
    queryFn: () =>
      rpc<CostBreakdown>("costs.query", { ...filters, workspaceId }),
    enabled: !!workspaceId,
  });
}

export function useRuns(workspaceId: string | null) {
  return useQuery<Run[]>({
    queryKey: queryKeys.runs(workspaceId!),
    queryFn: () => rpc<Run[]>("runs.list", { workspaceId }),
    enabled: !!workspaceId,
  });
}

export function useCurrentRun(workspaceId: string | null) {
  return useQuery<Run | null>({
    queryKey: queryKeys.currentRun(workspaceId!),
    queryFn: () => rpc<Run | null>("runs.current", { workspaceId }),
    enabled: !!workspaceId,
  });
}

export function useConfig(workspaceId: string | null) {
  return useQuery<OvConfig>({
    queryKey: queryKeys.config(workspaceId!),
    queryFn: () => rpc<OvConfig>("config.get", { workspaceId }),
    enabled: !!workspaceId,
  });
}

export function useStatusOverview(workspaceId: string | null) {
  return useQuery<StatusOverview>({
    queryKey: queryKeys.statusOverview(workspaceId!),
    queryFn: () =>
      rpc<StatusOverview>("status.overview", { workspaceId }),
    enabled: !!workspaceId,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useSlingAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      capability: string;
      workspaceId: string;
      taskId?: string;
    }) => rpc("agents.sling", params),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.agents(vars.workspaceId) });
      void qc.invalidateQueries({
        queryKey: queryKeys.statusOverview(vars.workspaceId),
      });
    },
  });
}

export function useStopAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { name: string; workspaceId: string }) =>
      rpc("agents.stop", params),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.agents(vars.workspaceId) });
      void qc.invalidateQueries({
        queryKey: queryKeys.statusOverview(vars.workspaceId),
      });
    },
  });
}

export function useNudgeAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      name: string;
      message: string;
      workspaceId: string;
    }) => rpc("agents.nudge", params),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.agents(vars.workspaceId) });
    },
  });
}

export function useSendMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      to: string;
      subject: string;
      body: string;
      type?: string;
      priority?: string;
      workspaceId: string;
    }) => rpc("mail.send", params),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.mail(vars.workspaceId) });
      void qc.invalidateQueries({
        queryKey: queryKeys.statusOverview(vars.workspaceId),
      });
    },
  });
}

export function useMarkMailRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; workspaceId: string }) =>
      rpc("mail.read", params),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: queryKeys.mail(vars.workspaceId) });
      void qc.invalidateQueries({
        queryKey: queryKeys.statusOverview(vars.workspaceId),
      });
    },
  });
}

export function useTriggerMerge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; workspaceId: string }) =>
      rpc("merge.trigger", params),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: queryKeys.mergeQueue(vars.workspaceId),
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.statusOverview(vars.workspaceId),
      });
    },
  });
}

export function useAddWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { path: string }) =>
      rpc("workspace.add", params),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces });
    },
  });
}

export function useRemoveWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string }) =>
      rpc("workspace.remove", params),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces });
    },
  });
}

export function useSetActiveWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string }) =>
      rpc("workspace.setActive", params),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.workspaces });
    },
  });
}
