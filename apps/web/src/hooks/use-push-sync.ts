import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  AgentSession,
  MergeEntry,
  MetricsSummary,
  StoredEvent,
  MailMessage,
  PushChannel,
} from "@emergent/contracts";
import { PushChannels } from "@emergent/contracts";
import { wsClient } from "./use-ws";
import { queryKeys } from "./use-overstory";

/**
 * Subscribes to all push channels for the given workspace and keeps the
 * React Query cache in sync with server-pushed updates.
 */
export function usePushSync(workspaceId: string | null) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!workspaceId) return;

    // Subscribe to all push channels
    const channels = [...PushChannels] as PushChannel[];
    wsClient.subscribe(channels, workspaceId);

    const unsubPush = wsClient.onPush((channel, data) => {
      switch (channel) {
        case "agents.changed":
          qc.setQueryData<AgentSession[]>(
            queryKeys.agents(workspaceId),
            () => data as AgentSession[],
          );
          void qc.invalidateQueries({
            queryKey: queryKeys.statusOverview(workspaceId),
          });
          break;

        case "events.new":
          qc.setQueryData<StoredEvent[]>(
            queryKeys.events(workspaceId),
            (old) => {
              const event = data as StoredEvent;
              return old ? [...old, event] : [event];
            },
          );
          break;

        case "mail.new":
          qc.setQueryData<MailMessage[]>(
            queryKeys.mail(workspaceId),
            (old) => {
              const msg = data as MailMessage;
              return old ? [...old, msg] : [msg];
            },
          );
          void qc.invalidateQueries({
            queryKey: queryKeys.statusOverview(workspaceId),
          });
          break;

        case "merge.changed":
          qc.setQueryData<MergeEntry[]>(
            queryKeys.mergeQueue(workspaceId),
            () => data as MergeEntry[],
          );
          void qc.invalidateQueries({
            queryKey: queryKeys.statusOverview(workspaceId),
          });
          break;

        case "metrics.snapshot":
          qc.setQueryData<MetricsSummary>(
            queryKeys.metrics(workspaceId),
            () => data as MetricsSummary,
          );
          break;

        case "coordinator.stateChanged": {
          const payload = data as { workspaceId?: string; state?: string; error?: string };
          const targetWId = payload.workspaceId ?? workspaceId;
          void qc.invalidateQueries({
            queryKey: queryKeys.coordinatorState(targetWId),
          });
          void qc.invalidateQueries({
            queryKey: queryKeys.statusOverview(targetWId),
          });
          break;
        }
      }
    });

    return () => {
      wsClient.unsubscribe(channels);
      unsubPush();
    };
  }, [workspaceId, qc]);
}
