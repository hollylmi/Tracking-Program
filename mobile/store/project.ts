import { create } from 'zustand'
import { Project } from '../types'

interface ProjectState {
  activeProject: Project | null
  setActiveProject: (project: Project) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  activeProject: null,
  setActiveProject: (project) => set({ activeProject: project }),
}))
