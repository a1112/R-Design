/** Cloud control-plane contract. No executable project source is uploaded. */
export type TeamRole = 'owner' | 'designer' | 'reviewer' | 'viewer';
export type ReviewStatus = 'draft' | 'in_review' | 'approved' | 'changes_requested';
export interface TeamUser { id: string; email: string; name: string; admin: boolean; }
export interface TeamMember { user: TeamUser; role: TeamRole; }
export interface TeamLayer { id: string; name: string; bounds: { x:number; y:number; w:number; h:number }; }
export interface TeamEvidence { name: string; passed: boolean; detail: string; }
export interface TeamVersion {
  id: string; projectId: string; number: number; title: string; summary: string;
  imageDataUrl: string; width: number; height: number; sourceUrl?: string;
  layers: TeamLayer[]; diff: string; evidence: TeamEvidence[];
  contentHash: string; status: ReviewStatus; createdAt: string; createdBy: TeamUser;
  submittedBy?: TeamUser; submittedAt?: string; decidedBy?: TeamUser; decidedAt?: string; decisionNote?: string;
}
export interface TeamProject {
  id: string; name: string; description: string; role: TeamRole; updatedAt: string;
  versionCount: number; pendingCount: number; latestVersion?: TeamVersion;
}
export interface TeamComment {
  id: string; versionId: string; text: string; anchor?: { x:number; y:number };
  createdAt: string; author: TeamUser;
}
export interface TeamActivity {
  id: string; action: string; subjectId: string; detail: string; createdAt: string; actor: TeamUser;
}
export interface TeamProjectDetail {
  project: TeamProject; members: TeamMember[]; versions: TeamVersion[];
  comments: TeamComment[]; activity: TeamActivity[];
}
export interface CreateTeamVersion {
  operationId: string; title: string; summary: string; imageDataUrl: string; sourceUrl?: string;
  layers?: TeamLayer[]; diff?: string; evidence?: TeamEvidence[];
}
