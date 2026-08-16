import express from "express";

import {
    getWorks,
    getArchivedWorks,
    getWork,

    createWork,
    updateWork,
    archiveWork,
    restoreWork,

    addParticipant,
    removeParticipant,
    transferOwnership,

    createTask,
    updateTask,
    completeTask,
    reopenTask,
    archiveTask,
    reorderTasks,

    createSubtask,
    updateSubtask,
    completeSubtask,
    reopenSubtask,
    archiveSubtask,
    reorderSubtasks,

    reorderWorks,

    getWorkActivity,
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


// ============================================================
// WORK PARTICIPANTS
// ============================================================


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


// POST /api/work/:workId/transfer-ownership
router.post(
    "/:workId/transfer-ownership",
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


// POST /api/work/:workId/tasks
router.post(
    "/:workId/tasks",
    createTask
);


// PATCH /api/work/:workId/tasks/:taskId
router.patch(
    "/:workId/tasks/:taskId",
    updateTask
);


// POST /api/work/:workId/tasks/:taskId/complete
//
// Only valid for tasks WITHOUT subtasks.
router.post(
    "/:workId/tasks/:taskId/complete",
    completeTask
);


// POST /api/work/:workId/tasks/:taskId/reopen
//
// Reopening is allowed even when Work is locked.
router.post(
    "/:workId/tasks/:taskId/reopen",
    reopenTask
);


// POST /api/work/:workId/tasks/:taskId/archive
//
// Archive instead of destroying the task.
router.post(
    "/:workId/tasks/:taskId/archive",
    archiveTask
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


// GET /api/work/:workId/activity
//
// Immutable WorkActivity history.
router.get(
    "/:workId/activity",
    getWorkActivity
);


// ============================================================
// EXPORT
// ============================================================

export default router;