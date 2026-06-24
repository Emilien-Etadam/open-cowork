import { fileExists } from './file-ops.js';

export type RequirementStatus = 'pending' | 'in-progress' | 'completed' | 'failed';

export interface Requirement {
  id: string;
  description: string;
  status: RequirementStatus;
  files: string[];
  createdAt: Date;
  updatedAt: Date;
  history: Array<{
    timestamp: Date;
    description: string;
    reason: string;
  }>;
}

const requirements = new Map<string, Requirement>();

export function generateRequirementId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function createRequirement(description: string, files: string[] = []): Requirement {
  const requirement: Requirement = {
    id: generateRequirementId(),
    description,
    status: 'pending',
    files,
    createdAt: new Date(),
    updatedAt: new Date(),
    history: [],
  };

  requirements.set(requirement.id, requirement);
  return requirement;
}

export function updateRequirement(
  requirementId: string,
  updatedDescription: string,
  reason: string,
  status?: RequirementStatus
): Requirement {
  const requirement = requirements.get(requirementId);
  if (!requirement) {
    throw new Error(`Requirement not found: ${requirementId}`);
  }

  requirement.history.push({
    timestamp: new Date(),
    description: requirement.description,
    reason,
  });

  requirement.description = updatedDescription;
  if (status) {
    requirement.status = status;
  }
  requirement.updatedAt = new Date();

  return requirement;
}

export async function validateRequirement(requirementId: string): Promise<{
  requirement: Requirement;
  validated: boolean;
  missingFiles: string[];
}> {
  const requirement = requirements.get(requirementId);
  if (!requirement) {
    throw new Error(`Requirement not found: ${requirementId}`);
  }

  const missingFiles: string[] = [];
  for (const file of requirement.files) {
    if (!(await fileExists(file))) {
      missingFiles.push(file);
    }
  }

  requirement.status = missingFiles.length === 0 ? 'completed' : 'failed';
  requirement.updatedAt = new Date();

  return {
    requirement,
    validated: missingFiles.length === 0,
    missingFiles,
  };
}

export function listRequirements(statusFilter?: RequirementStatus | 'all'): Requirement[] {
  const allRequirements = Array.from(requirements.values());

  if (!statusFilter || statusFilter === 'all') {
    return allRequirements;
  }

  return allRequirements.filter((requirement) => requirement.status === statusFilter);
}

export function getRequirementCount(): number {
  return requirements.size;
}
