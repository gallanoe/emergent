import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiStore {
  feedFollowMode: boolean;
  setFeedFollowMode: (follow: boolean) => void;
  selectedAgentName: string | null;
  setSelectedAgentName: (name: string | null) => void;
}

export const useUiStore = create<UiStore>()(
  persist(
    (set) => ({
      feedFollowMode: true,
      setFeedFollowMode: (follow) => set({ feedFollowMode: follow }),
      selectedAgentName: null,
      setSelectedAgentName: (name) => set({ selectedAgentName: name }),
    }),
    { name: "overstory-ui" },
  ),
);
