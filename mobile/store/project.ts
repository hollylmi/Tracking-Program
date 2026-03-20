import { create } from 'zustand'
import { Project } from '../types'

interface AvailableProject {
  id: number
  name: string
}

interface ProjectState {
  activeProject: Project | null
  availableProjects: AvailableProject[]
  setActiveProject: (project: Project) => void
  setAvailableProjects: (projects: AvailableProject[]) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  activeProject: null,
  availableProjects: [],
  setActiveProject: (project) => set({ activeProject: project }),
  setAvailableProjects: (projects) => set({ availableProjects: projects }),
}))
