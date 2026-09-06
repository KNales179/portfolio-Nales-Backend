import express from "express";

import {
    getWorks,
    getArchivedWorks,
    getWork,

    createWork,
    updateWork,
    archiveWork,
    restoreWork,
    lockWork,
    unlockWork,
    deleteWork,

    getWorkParticipants,
    addParticipant,
    removeParticipant,
    transferOwnership,

    createTask,
    updateTask,
    completeTask,
    reopenTask,
    archiveTask,
    restoreTask,
    reorderTasks,
    getArchivedTasks,
    deleteTask,

    createSubtask,
    updateSubtask,
    completeSubtask,
    reopenSubtask,
    archiveSubtask,
    restoreSubtask,
    reorderSubtasks,
    getArchivedSubtasks,
    deleteSubtask,

    reorderWorks,

    getWorkActivity,

    getWorkComments,
    createWorkComment,
    updateWorkComment,
    deleteWorkComment,

    getWorkLinks,
    createWorkLink,
    updateWorkLink,
    deleteWorkLink,
} from "../controllers/workController.js";

import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();


// ============================================================
// AUTHENTICATION
// ============================================================
//
// Every Work endpoint requires an authenticated admin.
//
// Permission checks are handled inside workController.js.
//
// ============================================================

router.use(protect);


// ============================================================
// WORKS
// ============================================================


// GET /api/work
//
// Active works.
router.get(
    "/",
    getWorks
);


// GET /api/work/archived
//
// Archived works.
//
// IMPORTANT:
// This must come BEFORE "/:workId" so Express does not interpret
// "archived" as a workId.
router.get(
    "/archived",
    getArchivedWorks
);


// GET /api/work/:workId
//
// Single Work with:
// - Work
// - Tasks
// - Subtasks
// - Progress
//
router.get(
    "/:workId",
    getWork
);


// POST /api/work
//
// Create Work.
router.post(
    "/",
    createWork
);


// PATCH /api/work/:workId
//
// Edit Work title/description.
//
// Creator + Superadmin.
router.patch(
    "/:workId",
    updateWork
);


// ============================================================
// WORK LIFECYCLE
// ============================================================


// POST /api/work/:workId/archive
router.post(
    "/:workId/archive",
    archiveWork
);


// POST /api/work/:workId/restore
router.post(
    "/:workId/restore",
    restoreWork
);


// POST /api/work/:workId/lock
router.post(
    "/:workId/lock",
    lockWork
);


// POST /api/work/:workId/unlock
router.post(
    "/:workId/unlock",
    unlockWork
);


// DELETE /api/work/:workId
//
// Permanent deletion. Superadmin only, work must be archived.
router.delete(
    "/:workId",
    deleteWork
);


// ============================================================
// WORK PARTICIPANTS
// ============================================================


// GET /api/work/:workId/participants
router.get(
    "/:workId/participants",
    getWorkParticipants
);


// POST /api/work/:workId/participants
router.post(
    "/:workId/participants",
    addParticipant
);


// DELETE /api/work/:workId/participants/:adminId
router.delete(
    "/:workId/participants/:adminId",
    removeParticipant
);


// PATCH /api/work/:workId/ownership
router.patch(
    "/:workId/ownership",
    transferOwnership
);


// ============================================================
// WORK REORDER
// ============================================================


// PATCH /api/work/reorder
//
// Body:
//
// {
//     "orderedIds": [
//         "workId1",
//         "workId2",
//         "workId3"
//     ]
// }
//
// Creator + Superadmin.
router.patch(
    "/reorder",
    reorderWorks
);


// ============================================================
// TASKS
// ============================================================
//
// Flat (not nested under :workId) because the controller
// derives `work` from `task.work` itself. Matches workApi.js.
//


// POST /api/work/:workId/tasks
//
// Creation still needs workId since the task doesn't exist yet.
router.post(
    "/:workId/tasks",
    createTask
);


// PATCH /api/work/tasks/:taskId
router.patch(
    "/tasks/:taskId",
    updateTask
);


// POST /api/work/tasks/:taskId/complete
//
// Only valid for tasks WITHOUT subtasks.
router.post(
    "/tasks/:taskId/complete",
    completeTask
);


// POST /api/work/tasks/:taskId/reopen
//
// Reopening is allowed even when Work is locked.
router.post(
    "/tasks/:taskId/reopen",
    reopenTask
);


// POST /api/work/tasks/:taskId/archive
//
// Archive instead of destroying the task.
router.post(
    "/tasks/:taskId/archive",
    archiveTask
);


// POST /api/work/tasks/:taskId/restore
router.post(
    "/tasks/:taskId/restore",
    restoreTask
);


// GET /api/work/:workId/tasks/archived
router.get(
    "/:workId/tasks/archived",
    getArchivedTasks
);


// DELETE /api/work/tasks/:taskId
//
// Permanent deletion. Superadmin only, task must be archived.
router.delete(
    "/tasks/:taskId",
    deleteTask
);


// PATCH /api/work/:workId/tasks/reorder
//
// Body:
//
// {
//     "orderedIds": [
//         "taskId1",
//         "taskId2"
//     ]
// }
router.patch(
    "/:workId/tasks/reorder",
    reorderTasks
);


// ============================================================
// SUBTASKS
// ============================================================
//
// Also flat, matching workApi.js.
//


// POST /api/work/tasks/:taskId/subtasks
router.post(
    "/tasks/:taskId/subtasks",
    createSubtask
);


// PATCH /api/work/subtasks/:subtaskId
router.patch(
    "/subtasks/:subtaskId",
    updateSubtask
);


// POST /api/work/subtasks/:subtaskId/complete
router.post(
    "/subtasks/:subtaskId/complete",
    completeSubtask
);


// POST /api/work/subtasks/:subtaskId/reopen
router.post(
    "/subtasks/:subtaskId/reopen",
    reopenSubtask
);


// POST /api/work/subtasks/:subtaskId/archive
router.post(
    "/subtasks/:subtaskId/archive",
    archiveSubtask
);


// POST /api/work/subtasks/:subtaskId/restore
router.post(
    "/subtasks/:subtaskId/restore",
    restoreSubtask
);


// GET /api/work/tasks/:taskId/subtasks/archived
router.get(
    "/tasks/:taskId/subtasks/archived",
    getArchivedSubtasks
);


// DELETE /api/work/subtasks/:subtaskId
//
// Permanent deletion. Superadmin only, subtask must be archived.
router.delete(
    "/subtasks/:subtaskId",
    deleteSubtask
);


// PATCH /api/work/tasks/:taskId/subtasks/reorder
//
// Body:
//
// {
//     "orderedIds": [
//         "subtaskId1",
//         "subtaskId2"
//     ]
// }
router.patch(
    "/tasks/:taskId/subtasks/reorder",
    reorderSubtasks
);


// ============================================================
// SUBTASKS
// ============================================================


// POST /api/work/:workId/tasks/:taskId/subtasks
router.post(
    "/:workId/tasks/:taskId/subtasks",
    createSubtask
);


// PATCH /api/work/:workId/tasks/:taskId/subtasks/:subtaskId
router.patch(
    "/:workId/tasks/:taskId/subtasks/:subtaskId",
    updateSubtask
);


// POST /api/work/:workId/tasks/:taskId/subtasks/:subtaskId/complete
router.post(
    "/:workId/tasks/:taskId/subtasks/:subtaskId/complete",
    completeSubtask
);


// POST /api/work/:workId/tasks/:taskId/subtasks/:subtaskId/reopen
router.post(
    "/:workId/tasks/:taskId/subtasks/:subtaskId/reopen",
    reopenSubtask
);


// POST /api/work/:workId/tasks/:taskId/subtasks/:subtaskId/archive
router.post(
    "/:workId/tasks/:taskId/subtasks/:subtaskId/archive",
    archiveSubtask
);


// PATCH /api/work/:workId/tasks/:taskId/subtasks/reorder
//
// Body:
//
// {
//     "orderedIds": [
//         "subtaskId1",
//         "subtaskId2"
//     ]
// }
router.patch(
    "/:workId/tasks/:taskId/subtasks/reorder",
    reorderSubtasks
);


// ============================================================
// WORK ACTIVITY
// ============================================================


// GET /api/work/:workId/activities
//
// Immutable WorkActivity history.
router.get(
    "/:workId/activities",
    getWorkActivity
);


// ============================================================
// COMMENTS
// ============================================================


// GET /api/work/:workId/comments
router.get(
    "/:workId/comments",
    getWorkComments
);


// POST /api/work/:workId/comments
router.post(
    "/:workId/comments",
    createWorkComment
);


// PATCH /api/work/comments/:commentId
router.patch(
    "/comments/:commentId",
    updateWorkComment
);


// DELETE /api/work/comments/:commentId
router.delete(
    "/comments/:commentId",
    deleteWorkComment
);


// ============================================================
// LINKS
// ============================================================


// GET /api/work/:workId/links
router.get(
    "/:workId/links",
    getWorkLinks
);


// POST /api/work/:workId/links
router.post(
    "/:workId/links",
    createWorkLink
);


// PATCH /api/work/links/:linkId
router.patch(
    "/links/:linkId",
    updateWorkLink
);


// DELETE /api/work/links/:linkId
router.delete(
    "/links/:linkId",
    deleteWorkLink
);


// ============================================================
// EXPORT
// ============================================================

export default router;