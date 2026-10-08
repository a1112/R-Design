---
name: review-ui-change
description: Review an R-Design candidate, its diff, visual evidence, scope and stale-baseline checks before acceptance.
---
Read current rd_get_context. Open rd_render_workspace in reviewMode to inspect the candidate and source diff. Explain the changed files, instance versus shared scope, confirmed constraints, validation evidence and unresolved limitations. A prepared or visually attractive candidate is not a verified implementation. Acceptance is bound to the candidate diffHash and current project revision. After explicit user acceptance of that concrete diff, call rd_apply_change with approval accept-reviewed-diff and the current write envelope. If Bridge reports conflicts, refresh and preserve the intervening changes. Never force overwrite, deploy or push as part of review.
