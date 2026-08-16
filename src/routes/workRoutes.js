import express from "express";

import {
    getWorks,
    getWorkById,

    createWork,
    updateWork,
    archiveWork,
    restoreWork,
    lockWork,
    unlockWork,
    reorderWorks,

    addParticipant,
    removeParticipant,
    transferOwnership,

    createTask,
    updateTask,
    archiveTask,
    restoreTask,
    reorderTasks,

    createSubtask,
    updateSubtask,
    completeSubtask,
    reopenSubtask,
    archiveSubtask,
    restoreSubtask,
    reorderSubtasks,

    getWorkActivities,
} from "../controllers/workController.js";

import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();


// ============================================================
// AUTHENTICATION
// ============================================================
//
// All Work routes require an authenticated admin.
//
// Authorization inside the controller determines whether the
// authenticated admin is:
//
// - Superadmin
// - Work creator / owner
// - Participant
// - Viewer
//
// Do NOT put role-specific authorization here unless we later
// create dedicated middleware for it.
// ============================================================

router.use(protect);


// ============================================================
// WORKS
// ============================================================


// GET /api/work
//
// Get all works the authenticated admin is allowed to see.
//
// Includes:
// - active works
// - progress
// - participants
// - creator
// - lock state
// - status
//
router.get(
    "/",
    getWorks
);


// GET /api/work/:workId
//
// Get one Work and its complete hierarchy.
//
// Expected response can include:
//
// Work
// ├── Tasks
// │   └── Subtasks
// ├── Participants
// └── Activity
//
router.get(
    "/:workId",
    getWorkById
);


// POST /api/work
//
// Create a new Work.
//
// Creator automatically becomes the owner.
//
// Creator should also automatically become a participant.
router.post(
    "/",
    createWork
);


// PATCH /api/work/:workId
//
// Update Work-level information.
//
// Important:
// Participants cannot edit the Work title/description.
//
// Controller determines whether the requester is:
// - creator
// - superadmin
//
router.patch(
    "/:workId",
    updateWork
);


// ============================================================
// WORK STATUS / LIFECYCLE
// ============================================================


// POST /api/work/:workId/archive
//
// Archive Work.
//
// Archived Work becomes read-only.
//
// Creator + Superadmin.
router.post(
    "/:workId/archive",
    archiveWork
);


// POST /api/work/:workId/restore
//
// Restore archived Work.
//
// Restores the Work exactly as it was.
//
// Creator + Superadmin.
router.post(
    "/:workId/restore",
    restoreWork
);


// POST /api/work/:workId/lock
//
// Lock Work.
//
// Prevents structural modifications:
//
// - add task
// - add subtask
// - edit task
// - edit subtask
// - reorder
// - add links
//
// Still allows:
// - reopen task
// - reopen subtask
// - comments
//
// Creator + Superadmin.
router.post(
    "/:workId/lock",
    lockWork
);


// POST /api/work/:workId/unlock
//
// Unlock Work.
//
// Creator + Superadmin.
router.post(
    "/:workId/unlock",
    unlockWork
);


// ============================================================
// WORK ORDERING
// ============================================================


// PATCH /api/work/reorder
//
// Reorder Works.
//
// Only Superadmin.
//
// Body example:
//
// {
//     "workIds": [
//         "workId1",
//         "workId2",
//         "workId3"
//     ]
// }
//
router.patch(
    "/reorder",
    reorderWorks
);


// ============================================================
// PARTICIPANTS
// ============================================================


// POST /api/work/:workId/participants
//
// Add one or more admins as participants.
//
// Allowed:
// - Work creator
// - Superadmin
//
// Participants cannot add participants.
//
router.post(
    "/:workId/participants",
    addParticipant
);


// DELETE /api/work/:workId/participants/:adminId
//
// Remove a participant.
//
// Allowed:
// - Work creator
// - Superadmin
//
// Creator cannot simply remove themselves.
// Ownership must be transferred first.
//
router.delete(
    "/:workId/participants/:adminId",
    removeParticipant
);


// POST /api/work/:workId/transfer-ownership
//
// Transfer Work ownership.
//
// Allowed:
// - Creator
// - Superadmin
//
// Superadmin may transfer ownership even when the current
// creator is inactive.
//
router.post(
    "/:workId/transfer-ownership",
    transferOwnership
);


// ============================================================
// TASKS
// ============================================================


// POST /api/work/:workId/tasks
//
// Add a Task.
//
// Allowed:
// - Creator
// - Participant
// - Superadmin
//
// Cannot be done while Work is:
// - ARCHIVED
// - LOCKED
//
router.post(
    "/:workId/tasks",
    createTask
);


// PATCH /api/work/:workId/tasks/:taskId
//
// Edit Task.
//
// Participants may edit Task information.
//
// Cannot edit while Work is archived or locked.
router.patch(
    "/:workId/tasks/:taskId",
    updateTask
);


// POST /api/work/:workId/tasks/:taskId/archive
//
// Archive Task.
//
// Archived Task remains in database.
//
// Creator + Superadmin.
//
// Depending on controller rules, participants should not
// archive structural data.
router.post(
    "/:workId/tasks/:taskId/archive",
    archiveTask
);


// POST /api/work/:workId/tasks/:taskId/restore
//
// Restore archived Task.
//
// Creator + Superadmin.
router.post(
    "/:workId/tasks/:taskId/restore",
    restoreTask
);


// PATCH /api/work/:workId/tasks/reorder
//
// Reorder Tasks.
//
// Allowed:
// - Work creator
// - Superadmin
//
// Participants cannot reorder Tasks.
//
// Body:
//
// {
//     "taskIds": [
//         "taskId1",
//         "taskId2"
//     ]
// }
//
router.patch(
    "/:workId/tasks/reorder",
    reorderTasks
);


// ============================================================
// SUBTASKS
// ============================================================


// POST /api/work/:workId/tasks/:taskId/subtasks
//
// Add Subtask.
//
// Allowed:
// - Creator
// - Participant
// - Superadmin
//
// Cannot add while Work is locked/archived.
router.post(
    "/:workId/tasks/:taskId/subtasks",
    createSubtask
);


// PATCH /api/work/:workId/tasks/:taskId/subtasks/:subtaskId
//
// Edit Subtask.
//
// Allowed:
// - Creator
// - Participant
// - Superadmin
//
// Cannot edit while Work is locked/archived.
router.patch(
    "/:workId/tasks/:taskId/subtasks/:subtaskId",
    updateSubtask
);


// POST /api/work/:workId/tasks/:taskId/subtasks/:subtaskId/complete
//
// Complete Subtask.
//
// This automatically recalculates:
//
// Subtask
// ↓
// Task
// ↓
// Work
//
// No manual percentage.
router.post(
    "/:workId/tasks/:taskId/subtasks/:subtaskId/complete",
    completeSubtask
);


// POST /api/work/:workId/tasks/:taskId/subtasks/:subtaskId/reopen
//
// Reopen Subtask.
//
// This can reopen the parent Task automatically.
//
// Locked Work still allows reopening.
router.post(
    "/:workId/tasks/:taskId/subtasks/:subtaskId/reopen",
    reopenSubtask
);


// POST /api/work/:workId/tasks/:taskId/subtasks/:subtaskId/archive
//
// Archive Subtask.
//
// Data remains in database.
//
// Creator + Superadmin.
router.post(
    "/:workId/tasks/:taskId/subtasks/:subtaskId/archive",
    archiveSubtask
);


// POST /api/work/:workId/tasks/:taskId/subtasks/:subtaskId/restore
//
// Restore Subtask.
//
// Creator + Superadmin.
router.post(
    "/:workId/tasks/:taskId/subtasks/:subtaskId/restore",
    restoreSubtask
);


// PATCH /api/work/:workId/tasks/:taskId/subtasks/reorder
//
// Reorder Subtasks.
//
// Allowed:
// - Creator
// - Participants
// - Superadmin
//
// Work must not be archived or locked.
//
// Body:
//
// {
//     "subtaskIds": [
//         "subtaskId1",
//         "subtaskId2"
//     ]
// }
//
router.patch(
    "/:workId/tasks/:taskId/subtasks/reorder",
    reorderSubtasks
);


// ============================================================
// ACTIVITY LOG
// ============================================================


// GET /api/work/:workId/activity
//
// Returns immutable WorkActivity history.
//
// Activity records are NEVER edited or deleted.
//
// Used by the Work UI to show:
//
// Admin changed task title
//
// Before:
// "Implement authentication"
//
// After:
// "Implement authentication middleware"
//
router.get(
    "/:workId/activity",
    getWorkActivities
);


// ============================================================
// EXPORT
// ============================================================

export default router;