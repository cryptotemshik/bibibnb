/**
 * Dashboard project registry — contract addresses only, persisted locally.
 * Launches made from this browser register themselves; anything else can be
 * added by address. No secrets in here.
 */
import { loadLaunchState } from "./launchState";

const KEY = "launchpad.projects.v1";

export interface ProjectEntry {
  address: string;
  /** Cached display bits so the table paints instantly on revisit. */
  name?: string;
  createdAt?: number;
  source: "launch" | "manual";
  addedAt: number;
}

export function loadProjects(): ProjectEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ProjectEntry[]) : [];
  } catch {
    return [];
  }
}

function save(projects: ProjectEntry[]): void {
  localStorage.setItem(KEY, JSON.stringify(projects));
}

export function upsertProject(entry: Omit<ProjectEntry, "addedAt">): ProjectEntry[] {
  const projects = loadProjects();
  const existing = projects.find(
    (p) => p.address.toLowerCase() === entry.address.toLowerCase(),
  );
  if (existing) {
    Object.assign(existing, entry);
  } else {
    projects.push({ ...entry, addedAt: Date.now() });
  }
  save(projects);
  return projects;
}

export function removeProject(address: string): ProjectEntry[] {
  const projects = loadProjects().filter(
    (p) => p.address.toLowerCase() !== address.toLowerCase(),
  );
  save(projects);
  return projects;
}

/** Pull a completed launch from the single-launch state into the registry. */
export function syncLaunchIntoRegistry(): ProjectEntry[] {
  const launch = loadLaunchState();
  if (launch?.contractAddress && launch.completedAt) {
    return upsertProject({
      address: launch.contractAddress,
      name: launch.form?.name,
      source: "launch",
    });
  }
  return loadProjects();
}
