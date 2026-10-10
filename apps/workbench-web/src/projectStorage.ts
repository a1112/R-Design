/** Drafts stay on their engineering project even while another project is active. */
export function projectStorageKey(projectId: string, field: 'note' | 'frame' | 'strokes' | 'agent-run') {
  return `rdesign.project.${projectId}.${field}`;
}
export function migrateLegacyDrafts(projectId: string) {
  const marker='rdesign.legacy-drafts-migrated.v1';
  if(localStorage.getItem(marker))return;
  const fields=['note','frame','strokes','agent-run'] as const;
  for(const field of fields){const old=field==='agent-run'?'rd-agent-run':`rd-draft-${field}`;const value=localStorage.getItem(old);if(value!==null&&!localStorage.getItem(projectStorageKey(projectId,field)))localStorage.setItem(projectStorageKey(projectId,field),value);}
  localStorage.setItem(marker,projectId);
  for(const field of fields)localStorage.removeItem(field==='agent-run'?'rd-agent-run':`rd-draft-${field}`);
}
