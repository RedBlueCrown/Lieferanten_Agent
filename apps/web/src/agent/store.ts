import { create } from 'zustand';
import type { AgentKind } from '@vm/domain';

export interface StageJob {
  jobId: string;
  kind: AgentKind;
  title: string;
  /** Where "Ergebnis ansehen" leads. */
  resultPath: string;
  resultLabel: string;
}

interface StageStore {
  job: StageJob | null;
  minimized: boolean;
  done: boolean;
  open: (j: StageJob) => void;
  minimize: () => void;
  restore: () => void;
  setDone: (d: boolean) => void;
  close: () => void;
}

export const useStage = create<StageStore>((set) => ({
  job: null,
  minimized: false,
  done: false,
  open: (job) => set({ job, minimized: false, done: false }),
  minimize: () => set({ minimized: true }),
  restore: () => set({ minimized: false }),
  setDone: (done) => set({ done }),
  close: () => set({ job: null, minimized: false, done: false }),
}));
