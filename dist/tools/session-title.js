// Title the active session after the workflow it is running (#60). Sessions carry
// only a `title` (no agent field), so this is the one SDK rename lever — it
// surfaces "which workflow is this session running" in the sessions list/header.
// It does NOT change the mode / active-agent indicator (see #58).
//
// Best-effort: a missing session id or a failed update must never break a run.
export async function titleSession(client, sessionId, workflowName) {
    if (!sessionId)
        return;
    try {
        await client.session.update({
            path: { id: sessionId },
            body: { title: `workflow: ${workflowName}` },
        });
    }
    catch {
        /* best-effort breadcrumb — swallow errors */
    }
}
//# sourceMappingURL=session-title.js.map