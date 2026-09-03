import mongoose from "mongoose";

import Work from "../models/Work.js";
import WorkTask from "../models/WorkTask.js";
import WorkSubtask from "../models/WorkSubtask.js";
import WorkActivity from "../models/WorkActivity.js";
import WorkComment from "../models/WorkComment.js";
import WorkLink from "../models/WorkLink.js";


// ============================================================
// HELPERS
// ============================================================

const isValidObjectId = (id) => {
    return mongoose.Types.ObjectId.isValid(id);
};


const isSuperAdmin = (admin) => {
    return admin?.role === "SUPER_ADMIN";
};


const isCreator = (work, adminId) => {
    return (
        work.createdBy?.toString() ===
        adminId?.toString()
    );
};


const isParticipant = (work, adminId) => {
    return work.participants?.some(
        (participant) =>
            participant.admin?.toString() ===
            adminId?.toString()
    );
};


const canEditWork = (work, admin) => {
    return (
        isSuperAdmin(admin) ||
        isCreator(work, admin._id) ||
        isParticipant(work, admin._id)
    );
};


const canManageParticipants = (work, admin) => {
    return (
        isSuperAdmin(admin) ||
        isCreator(work, admin._id)
    );
};


const canManageWork = (work, admin) => {
    return (
        isSuperAdmin(admin) ||
        isCreator(work, admin._id)
    );
};


const canReorderWork = (work, admin) => {
    return (
        isSuperAdmin(admin) ||
        isCreator(work, admin._id)
    );
};


const canEditArchivedWork = () => {
    return false;
};


const canModifyLockedStructure = () => {
    return false;
};


const ensureWorkEditable = (work) => {
    if (work.status === "ARCHIVED") {
        return {
            allowed: false,
            message:
                "Archived work is read-only.",
        };
    }

    return {
        allowed: true,
    };
};


const ensureWorkUnlocked = (work) => {
    if (work.isLocked) {
        return {
            allowed: false,
            message:
                "This work is locked.",
        };
    }

    return {
        allowed: true,
    };
};


const isValidHttpsUrl = (value) => {
    if (
        typeof value !== "string" ||
        !value.trim()
    ) {
        return false;
    }

    try {
        const parsed =
            new URL(value.trim());

        return (
            parsed.protocol ===
            "https:"
        );
    } catch {
        return false;
    }
};


// ============================================================
// ACTIVITY LOGGER
// ============================================================
//
// resourceType is now REQUIRED because WorkActivity's schema
// requires it. Every call site below has been updated to pass it.
//

const createActivity = async ({
    work,
    admin,
    action,
    resourceType,
    task = null,
    subtask = null,
    description,
    metadata = {},
}) => {
    return WorkActivity.create({
        work:
            work?._id ||
            work,

        admin:
            admin?._id ||
            admin,

        action,

        resourceType,

        task,

        subtask,

        description,

        metadata,
    });
};


// ============================================================
// PROGRESS CALCULATION
// ============================================================
//
// Work progress is based on TASKS.
//
// A task with no subtasks:
//      completed = task.status === COMPLETED
//
// A task with subtasks:
//      completed = ALL subtasks completed
//
// No manual percentage.
// No subtask weighting.
// Every task has equal weight.
//

const calculateTaskProgress = async (taskId) => {
    const subtasks =
        await WorkSubtask.find({
            task: taskId,
            status: {
                $ne: "ARCHIVED",
            },
        });

    if (subtasks.length === 0) {
        const task =
            await WorkTask.findById(
                taskId
            );

        return task?.status ===
            "COMPLETED"
            ? 100
            : 0;
    }

    const completed =
        subtasks.filter(
            (subtask) =>
                subtask.completed
        ).length;

    return Math.round(
        (completed /
            subtasks.length) *
        100
    );
};


const calculateWorkProgress = async (
    workId
) => {
    const tasks =
        await WorkTask.find({
            work: workId,
            status: {
                $ne: "ARCHIVED",
            },
        });

    if (tasks.length === 0) {
        return 0;
    }

    let completedTasks = 0;

    for (const task of tasks) {
        const subtasks =
            await WorkSubtask.find({
                task: task._id,
                status: {
                    $ne: "ARCHIVED",
                },
            });

        if (subtasks.length === 0) {
            if (
                task.status ===
                "COMPLETED"
            ) {
                completedTasks++;
            }

            continue;
        }

        const allCompleted =
            subtasks.every(
                (subtask) =>
                    subtask.completed
            );

        if (allCompleted) {
            completedTasks++;
        }
    }

    return Math.round(
        (completedTasks /
            tasks.length) *
        100
    );
};


// ============================================================
// SYNC TASK STATUS
// ============================================================

const syncTaskStatus = async (
    taskId,
    admin,
    work
) => {
    const subtasks =
        await WorkSubtask.find({
            task: taskId,
            status: {
                $ne: "ARCHIVED",
            },
        });

    const task =
        await WorkTask.findById(
            taskId
        );

    if (!task) {
        return null;
    }

    // --------------------------------------------------------
    // NO SUBTASKS
    // --------------------------------------------------------

    if (subtasks.length === 0) {
        return task;
    }

    // --------------------------------------------------------
    // ALL SUBTASKS COMPLETED
    // --------------------------------------------------------

    const allCompleted =
        subtasks.every(
            (subtask) =>
                subtask.completed
        );

    // WorkTask's status enum is strictly INCOMPLETE / COMPLETED /
    // ARCHIVED. Partial subtask progress is never stored on the
    // task itself — only whether ALL active subtasks are done.

    const newStatus =
        allCompleted
            ? "COMPLETED"
            : "INCOMPLETE";

    if (
        task.status !==
        newStatus
    ) {
        const previousStatus =
            task.status;

        task.status =
            newStatus;

        task.completed =
            newStatus === "COMPLETED";

        task.completedAt =
            newStatus === "COMPLETED"
                ? new Date()
                : null;

        task.completedBy =
            newStatus === "COMPLETED"
                ? admin._id
                : null;

        task.updatedBy =
            admin._id;

        await task.save();

        const activityAction =
            newStatus === "COMPLETED"
                ? "TASK_COMPLETED"
                : "TASK_REOPENED";

        await createActivity({
            work,
            admin,
            action: activityAction,
            resourceType: "TASK",
            task: task._id,
            description:
                `Task status changed from ${previousStatus} to ${newStatus}.`,
            metadata: {
                before: {
                    status:
                        previousStatus,
                },
                after: {
                    status:
                        newStatus,
                },
            },
        });
    }

    return task;
};


// ============================================================
// SYNC WORK STATUS
// ============================================================
//
// Progress is automatic.
//
// Completed work is NOT automatically locked.
//
// Adding a new task to completed work
// automatically moves it back to IN_PROGRESS.
//
// NOTE: The Work model's status enum only allows
// IN_PROGRESS / COMPLETED / ARCHIVED (no "PLANNED").
// Setting work.status = "PLANNED" below will fail Work's
// own schema validation on save. Left as-is for now since
// this is a separate bug from the WorkActivity one — flagging
// it here so it's not missed.
//

const syncWorkStatus = async (
    workId,
    admin = null
) => {
    const work =
        await Work.findById(
            workId
        );

    if (!work) {
        return null;
    }

    if (
        work.status ===
        "ARCHIVED"
    ) {
        return work;
    }

    const progress =
        await calculateWorkProgress(
            workId
        );

    const previousStatus =
        work.status;

    if (progress === 100) {
        work.status =
            "COMPLETED";
    } else {
        work.status =
            "IN_PROGRESS";
    }

    if (
        previousStatus !==
        work.status &&
        admin
    ) {
        work.updatedBy =
            admin._id;

        await createActivity({
            work,
            admin,
            action:
                "WORK_UPDATED",
            resourceType: "WORK",
            description:
                `Work status changed from ${previousStatus} to ${work.status}.`,
            metadata: {
                before: {
                    status:
                        previousStatus,
                },
                after: {
                    status:
                        work.status,
                },
                progress,
            },
        });
    }

    await work.save();

    return work;
};


// ============================================================
// GET ALL WORKS
// ============================================================

export const getWorks =
    async (
        req,
        res
    ) => {
        try {
            const works =
                await Work.find({
                    status: {
                        $ne: "ARCHIVED",
                    },
                })
                    .populate(
                        "createdBy",
                        "username fullName role"
                    )
                    .populate(
                        "updatedBy",
                        "username fullName"
                    )
                    .populate(
                        "participants.admin",
                        "username fullName role"
                    )
                    .sort({
                        order: 1,
                        createdAt: 1,
                    });

            const result = [];

            for (const work of works) {
                const progress =
                    await calculateWorkProgress(
                        work._id
                    );

                result.push({
                    ...work.toObject(),
                    progress,
                });
            }

            return res.json({
                success: true,
                data: {
                    works: result,
                },
            });
        } catch (error) {
            console.error(
                "Get works error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to load works.",
            });
        }
    };


// ============================================================
// GET ARCHIVED WORKS
// ============================================================

export const getArchivedWorks =
    async (
        req,
        res
    ) => {
        try {
            const works =
                await Work.find({
                    status:
                        "ARCHIVED",
                })
                    .populate(
                        "createdBy",
                        "username fullName role"
                    )
                    .populate(
                        "participants.admin",
                        "username fullName role"
                    )
                    .sort({
                        order: 1,
                        updatedAt: -1,
                    });

            const result = [];

            for (const work of works) {
                const progress =
                    await calculateWorkProgress(
                        work._id
                    );

                result.push({
                    ...work.toObject(),
                    progress,
                });
            }

            return res.json({
                success: true,
                data: {
                    works: result,
                },
            });
        } catch (error) {
            console.error(
                "Get archived works error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to load archived works.",
            });
        }
    };


// ============================================================
// GET SINGLE WORK
// ============================================================

export const getWork =
    async (
        req,
        res
    ) => {
        try {
            const {
                workId,
            } = req.params;

            if (
                !isValidObjectId(
                    workId
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid work ID.",
                });
            }

            const work =
                await Work.findById(
                    workId
                )
                    .populate(
                        "createdBy",
                        "username fullName role status"
                    )
                    .populate(
                        "updatedBy",
                        "username fullName"
                    )
                    .populate(
                        "participants.admin",
                        "username fullName role status"
                    );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            const tasks =
                await WorkTask.find({
                    work: work._id,
                    status: {
                        $ne: "ARCHIVED",
                    },
                })
                    .populate(
                        "createdBy",
                        "username fullName"
                    )
                    .populate(
                        "updatedBy",
                        "username fullName"
                    )
                    .sort({
                        order: 1,
                    });

            const taskIds =
                tasks.map(
                    (task) =>
                        task._id
                );

            const subtasks =
                taskIds.length
                    ? await WorkSubtask.find({
                        task: {
                            $in: taskIds,
                        },
                        status: {
                            $ne:
                                "ARCHIVED",
                        },
                    })
                        .populate(
                            "createdBy",
                            "username fullName"
                        )
                        .populate(
                            "updatedBy",
                            "username fullName"
                        )
                        .sort({
                            order: 1,
                        })
                    : [];

            const tasksWithSubtasks =
                tasks.map(
                    (task) => {
                        const taskSubtasks =
                            subtasks.filter(
                                (
                                    subtask
                                ) =>
                                    subtask.task.toString() ===
                                    task._id.toString()
                            );

                        return {
                            ...task.toObject(),
                            subtasks:
                                taskSubtasks,
                        };
                    }
                );

            const progress =
                await calculateWorkProgress(
                    work._id
                );

            return res.json({
                success: true,
                data: {
                    work,
                    tasks:
                        tasksWithSubtasks,
                    progress,
                },
            });
        } catch (error) {
            console.error(
                "Get work error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to load work.",
            });
        }
    };


// ============================================================
// CREATE WORK
// ============================================================

export const createWork =
    async (
        req,
        res
    ) => {
        try {
            const {
                title,
                description,
                accessMode,
                password,
            } = req.body;

            if (
                !title?.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Work title is required.",
                });
            }

            if (
                !description?.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Work description is required.",
                });
            }

            const lastWork =
                await Work.findOne({
                    status: {
                        $ne: "ARCHIVED",
                    },
                }).sort({
                    order: -1,
                });

            const nextOrder =
                lastWork
                    ? lastWork.order + 1
                    : 0;

            const work =
                await Work.create({
                    title:
                        title.trim(),

                    description:
                        description.trim(),

                    status:
                        "IN_PROGRESS",

                    order:
                        nextOrder,

                    createdBy:
                        req.user._id,

                    owner:
                        req.user._id,

                    updatedBy:
                        req.user._id,

                    password:
                        password ||
                        null,

                    participants: [
                        {
                            admin:
                                req.user._id,

                            addedBy:
                                req.user._id,

                            addedAt:
                                new Date(),
                        },
                    ],

                });

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "WORK_CREATED",
                resourceType: "WORK",
                description:
                    `Work "${work.title}" was created.`,
                metadata: {
                    after: {
                        title:
                            work.title,
                        description:
                            work.description,
                        status:
                            work.status,
                    },
                },
            });

            return res.status(201).json({
                success: true,
                message:
                    "Work created successfully.",
                data: {
                    work,
                    progress: 0,
                },
            });
        } catch (error) {
            console.error(
                "Create work error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to create work.",
            });
        }
    };


// ============================================================
// UPDATE WORK
// ============================================================
//
// Participants CANNOT edit title/description.
// Creator + Superadmin can.
//

export const updateWork =
    async (
        req,
        res
    ) => {
        try {
            const {
                workId,
            } = req.params;

            if (
                !isValidObjectId(
                    workId
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid work ID.",
                });
            }

            const work =
                await Work.findById(
                    workId
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canManageWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to edit this work.",
                });
            }

            const editable =
                ensureWorkEditable(
                    work
                );

            if (!editable.allowed) {
                return res.status(409).json({
                    success: false,
                    message:
                        editable.message,
                });
            }

            const before = {
                title:
                    work.title,

                description:
                    work.description,
            };

            if (
                req.body.title !==
                undefined
            ) {
                if (
                    !req.body.title?.trim()
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Work title cannot be empty.",
                    });
                }

                work.title =
                    req.body.title.trim();
            }

            if (
                req.body.description !==
                undefined
            ) {
                if (
                    !req.body.description?.trim()
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Work description cannot be empty.",
                    });
                }

                work.description =
                    req.body.description.trim();
            }

            work.updatedBy =
                req.user._id;

            await work.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "WORK_UPDATED",
                resourceType: "WORK",
                description:
                    `Work "${work.title}" was updated.`,
                metadata: {
                    before,
                    after: {
                        title:
                            work.title,
                        description:
                            work.description,
                    },
                },
            });

            return res.json({
                success: true,
                message:
                    "Work updated successfully.",
                data: {
                    work,
                },
            });
        } catch (error) {
            console.error(
                "Update work error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to update work.",
            });
        }
    };


// ============================================================
// ARCHIVE WORK
// ============================================================

export const archiveWork =
    async (
        req,
        res
    ) => {
        try {
            const {
                workId,
            } = req.params;

            const work =
                await Work.findById(
                    workId
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canManageWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to archive this work.",
                });
            }

            if (
                work.status ===
                "ARCHIVED"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Work is already archived.",
                });
            }

            const previousStatus =
                work.status;

            work.status =
                "ARCHIVED";

            work.updatedBy =
                req.user._id;

            await work.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "WORK_ARCHIVED",
                resourceType: "WORK",
                description:
                    `Work "${work.title}" was archived.`,
                metadata: {
                    before: {
                        status:
                            previousStatus,
                    },
                    after: {
                        status:
                            "ARCHIVED",
                    },
                },
            });

            return res.json({
                success: true,
                message:
                    "Work archived successfully.",
            });
        } catch (error) {
            console.error(
                "Archive work error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to archive work.",
            });
        }
    };


// ============================================================
// RESTORE WORK
// ============================================================

export const restoreWork =
    async (
        req,
        res
    ) => {
        try {
            const {
                workId,
            } = req.params;

            const work =
                await Work.findById(
                    workId
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canManageWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to restore this work.",
                });
            }

            if (
                work.status !==
                "ARCHIVED"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Work is not archived.",
                });
            }

            work.status =
                "IN_PROGRESS";

            work.updatedBy =
                req.user._id;

            await work.save();

            await syncWorkStatus(
                work._id,
                req.user
            );

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "WORK_RESTORED",
                resourceType: "WORK",
                description:
                    `Work "${work.title}" was restored.`,
                metadata: {
                    before: {
                        status:
                            "ARCHIVED",
                    },
                    after: {
                        status:
                            work.status,
                    },
                },
            });

            return res.json({
                success: true,
                message:
                    "Work restored successfully.",
                data: {
                    work,
                },
            });
        } catch (error) {
            console.error(
                "Restore work error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to restore work.",
            });
        }
    };


// ============================================================
// LOCK WORK
// ============================================================

export const lockWork =
    async (
        req,
        res
    ) => {
        try {
            const work =
                await Work.findById(
                    req.params.workId
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canManageWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "Only the work creator or Superadmin can lock this work.",
                });
            }

            if (
                work.status ===
                "ARCHIVED"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Archived work cannot be locked.",
                });
            }

            if (work.isLocked) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Work is already locked.",
                });
            }

            work.isLocked =
                true;

            work.locked =
                true;

            work.lockedAt =
                new Date();

            work.lockedBy =
                req.user._id;

            work.updatedBy =
                req.user._id;

            await work.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "WORK_LOCKED",
                resourceType: "WORK",
                description:
                    `Work "${work.title}" was locked.`,
                metadata: {
                    after: {
                        locked:
                            true,
                    },
                },
            });

            return res.json({
                success: true,
                message:
                    "Work locked successfully.",
                data: {
                    work,
                },
            });
        } catch (error) {
            console.error(
                "Lock work error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to lock work.",
            });
        }
    };


// ============================================================
// UNLOCK WORK
// ============================================================

export const unlockWork =
    async (
        req,
        res
    ) => {
        try {
            const work =
                await Work.findById(
                    req.params.workId
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canManageWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "Only the work creator or Superadmin can unlock this work.",
                });
            }

            if (
                work.status ===
                "ARCHIVED"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Archived work cannot be unlocked.",
                });
            }

            if (!work.isLocked) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Work is not locked.",
                });
            }

            work.isLocked =
                false;

            work.locked =
                false;

            work.lockedAt =
                null;

            work.lockedBy =
                null;

            work.updatedBy =
                req.user._id;

            await work.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "WORK_UNLOCKED",
                resourceType: "WORK",
                description:
                    `Work "${work.title}" was unlocked.`,
                metadata: {
                    before: {
                        locked:
                            true,
                    },
                    after: {
                        locked:
                            false,
                    },
                },
            });

            return res.json({
                success: true,
                message:
                    "Work unlocked successfully.",
                data: {
                    work,
                },
            });
        } catch (error) {
            console.error(
                "Unlock work error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to unlock work.",
            });
        }
    };


// ============================================================
// GET WORK PARTICIPANTS
// ============================================================

export const getWorkParticipants =
    async (
        req,
        res
    ) => {
        try {
            const {
                workId,
            } = req.params;

            if (
                !isValidObjectId(
                    workId
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid work ID.",
                });
            }

            const work =
                await Work.findById(
                    workId
                )
                    .populate(
                        "createdBy",
                        "username fullName role status"
                    )
                    .populate(
                        "participants.admin",
                        "username fullName role status"
                    );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            return res.json({
                success: true,
                data: {
                    creator:
                        work.createdBy,
                    participants:
                        work.participants,
                },
            });
        } catch (error) {
            console.error(
                "Get work participants error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to load participants.",
            });
        }
    };


// ============================================================
// ADD PARTICIPANT
// ============================================================

export const addParticipant =
    async (
        req,
        res
    ) => {
        try {
            const {
                workId,
            } = req.params;

            const {
                adminId,
            } = req.body;

            if (
                !isValidObjectId(
                    adminId
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid admin ID.",
                });
            }

            const work =
                await Work.findById(
                    workId
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canManageParticipants(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "Only the work creator or Superadmin can manage participants.",
                });
            }

            const alreadyParticipant =
                isParticipant(
                    work,
                    adminId
                );

            if (
                alreadyParticipant
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Admin is already a participant.",
                });
            }

            work.participants.push({
                admin:
                    adminId,

                addedBy:
                    req.user._id,

                addedAt:
                    new Date(),
            });

            work.updatedBy =
                req.user._id;

            await work.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "PARTICIPANT_ADDED",
                resourceType: "PARTICIPANT",
                description:
                    "An admin was added as a work participant.",
                metadata: {
                    participant:
                        adminId,
                },
            });

            return res.json({
                success: true,
                message:
                    "Participant added successfully.",
                data: {
                    work,
                },
            });
        } catch (error) {
            console.error(
                "Add participant error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to add participant.",
            });
        }
    };


// ============================================================
// REMOVE PARTICIPANT
// ============================================================

export const removeParticipant =
    async (
        req,
        res
    ) => {
        try {
            const {
                workId,
                adminId,
            } = req.params;

            const work =
                await Work.findById(
                    workId
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canManageParticipants(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "Only the work creator or Superadmin can manage participants.",
                });
            }

            if (
                isCreator(
                    work,
                    adminId
                )
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "The work creator cannot be removed. Transfer ownership first.",
                });
            }

            const previousCount =
                work.participants.length;

            work.participants =
                work.participants.filter(
                    (
                        participant
                    ) =>
                        participant.admin?.toString() !==
                        adminId
                );

            if (
                previousCount ===
                work.participants.length
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Participant not found.",
                });
            }

            work.updatedBy =
                req.user._id;

            await work.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "PARTICIPANT_REMOVED",
                resourceType: "PARTICIPANT",
                description:
                    "A work participant was removed.",
                metadata: {
                    participant:
                        adminId,
                },
            });

            return res.json({
                success: true,
                message:
                    "Participant removed successfully.",
                data: {
                    work,
                },
            });
        } catch (error) {
            console.error(
                "Remove participant error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to remove participant.",
            });
        }
    };


// ============================================================
// TRANSFER OWNERSHIP
// ============================================================

export const transferOwnership =
    async (
        req,
        res
    ) => {
        try {
            const {
                workId,
            } = req.params;

            const {
                adminId,
            } = req.body;

            const work =
                await Work.findById(
                    workId
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !isSuperAdmin(
                    req.user
                ) &&
                !isCreator(
                    work,
                    req.user._id
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to transfer ownership.",
                });
            }

            if (
                !isValidObjectId(
                    adminId
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid admin ID.",
                });
            }

            const previousOwner =
                work.createdBy;

            work.createdBy =
                adminId;

            work.updatedBy =
                req.user._id;

            const alreadyParticipant =
                isParticipant(
                    work,
                    adminId
                );

            if (
                !alreadyParticipant
            ) {
                work.participants.push({
                    admin:
                        adminId,

                    addedBy:
                        req.user._id,

                    addedAt:
                        new Date(),
                });
            }

            await work.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "WORK_OWNER_CHANGED",
                resourceType: "WORK",
                description:
                    "Work ownership was transferred.",
                metadata: {
                    before: {
                        createdBy:
                            previousOwner,
                    },
                    after: {
                        createdBy:
                            adminId,
                    },
                },
            });

            return res.json({
                success: true,
                message:
                    "Work ownership transferred successfully.",
                data: {
                    work,
                },
            });
        } catch (error) {
            console.error(
                "Transfer ownership error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to transfer ownership.",
            });
        }
    };


// ============================================================
// CREATE TASK
// ============================================================

export const createTask =
    async (
        req,
        res
    ) => {
        try {
            const {
                workId,
            } = req.params;

            const {
                title,
                description,
            } = req.body;

            const work =
                await Work.findById(
                    workId
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canEditWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to add tasks.",
                });
            }

            let check =
                ensureWorkEditable(
                    work
                );

            if (!check.allowed) {
                return res.status(409).json({
                    success: false,
                    message:
                        check.message,
                });
            }

            check =
                ensureWorkUnlocked(
                    work
                );

            if (!check.allowed) {
                return res.status(409).json({
                    success: false,
                    message:
                        check.message,
                });
            }

            if (
                !title?.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Task title is required.",
                });
            }

            if (
                !description?.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Task description is required.",
                });
            }

            const lastTask =
                await WorkTask.findOne({
                    work: work._id,
                    status: {
                        $ne:
                            "ARCHIVED",
                    },
                }).sort({
                    order: -1,
                });

            const order =
                lastTask
                    ? lastTask.order + 1
                    : 0;

            const previousWorkStatus =
                work.status;

            const task =
                await WorkTask.create({
                    work:
                        work._id,

                    title:
                        title.trim(),

                    description:
                        description.trim(),

                    status:
                        "INCOMPLETE",

                    order,

                    createdBy:
                        req.user._id,

                    updatedBy:
                        req.user._id,
                });

            // Adding a task to a completed
            // work automatically reopens it.

            if (
                previousWorkStatus ===
                "COMPLETED"
            ) {
                work.status =
                    "IN_PROGRESS";

                work.updatedBy =
                    req.user._id;

                await work.save();
            }

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "TASK_CREATED",
                resourceType: "TASK",
                task:
                    task._id,
                description:
                    `Task "${task.title}" was created.`,
                metadata: {
                    after: {
                        title:
                            task.title,
                        description:
                            task.description,
                    },
                },
            });

            return res.status(201).json({
                success: true,
                message:
                    "Task created successfully.",
                data: {
                    task,
                },
            });
        } catch (error) {
            console.error(
                "Create task error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to create task.",
            });
        }
    };


// ============================================================
// UPDATE TASK
// ============================================================

export const updateTask =
    async (
        req,
        res
    ) => {
        try {
            const task =
                await WorkTask.findById(
                    req.params.taskId
                );

            if (!task) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Task not found.",
                });
            }

            const work =
                await Work.findById(
                    task.work
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canEditWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to edit this task.",
                });
            }

            let check =
                ensureWorkEditable(
                    work
                );

            if (!check.allowed) {
                return res.status(409).json({
                    success: false,
                    message:
                        check.message,
                });
            }

            check =
                ensureWorkUnlocked(
                    work
                );

            if (!check.allowed) {
                return res.status(409).json({
                    success: false,
                    message:
                        check.message,
                });
            }

            const before = {
                title:
                    task.title,

                description:
                    task.description,
            };

            if (
                req.body.title !==
                undefined
            ) {
                if (
                    !req.body.title?.trim()
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Task title cannot be empty.",
                    });
                }

                task.title =
                    req.body.title.trim();
            }

            if (
                req.body.description !==
                undefined
            ) {
                if (
                    !req.body.description?.trim()
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Task description cannot be empty.",
                    });
                }

                task.description =
                    req.body.description.trim();
            }

            task.updatedBy =
                req.user._id;

            await task.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "TASK_UPDATED",
                resourceType: "TASK",
                task:
                    task._id,
                description:
                    `Task "${task.title}" was updated.`,
                metadata: {
                    before,
                    after: {
                        title:
                            task.title,
                        description:
                            task.description,
                    },
                },
            });

            return res.json({
                success: true,
                message:
                    "Task updated successfully.",
                data: {
                    task,
                },
            });
        } catch (error) {
            console.error(
                "Update task error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to update task.",
            });
        }
    };


// ============================================================
// COMPLETE TASK
// ============================================================

export const completeTask =
    async (
        req,
        res
    ) => {
        try {
            const task =
                await WorkTask.findById(
                    req.params.taskId
                );

            if (!task) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Task not found.",
                });
            }

            const work =
                await Work.findById(
                    task.work
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canEditWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to complete this task.",
                });
            }

            if (
                work.status ===
                "ARCHIVED"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Archived work is read-only.",
                });
            }

            if (
                work.isLocked
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Locked work cannot have tasks completed.",
                });
            }

            const subtasks =
                await WorkSubtask.find({
                    task:
                        task._id,
                    status: {
                        $ne:
                            "ARCHIVED",
                    },
                });

            // ------------------------------------------------
            // Tasks WITH subtasks
            // ------------------------------------------------
            //
            // Their completion is derived from subtasks.
            // Therefore we do not manually complete them.
            //

            if (
                subtasks.length > 0
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "This task has subtasks. Complete its subtasks instead.",
                });
            }

            const previousStatus =
                task.status;

            task.status =
                "COMPLETED";

            task.completed =
                true;

            task.completedAt =
                new Date();

            task.completedBy =
                req.user._id;

            task.updatedBy =
                req.user._id;

            await task.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "TASK_COMPLETED",
                resourceType: "TASK",
                task:
                    task._id,
                description:
                    `Task "${task.title}" was completed.`,
                metadata: {
                    before: {
                        status:
                            previousStatus,
                    },
                    after: {
                        status:
                            "COMPLETED",
                    },
                },
            });

            await syncWorkStatus(
                work._id,
                req.user
            );

            return res.json({
                success: true,
                message:
                    "Task completed successfully.",
                data: {
                    task,
                    progress:
                        await calculateWorkProgress(
                            work._id
                        ),
                },
            });
        } catch (error) {
            console.error(
                "Complete task error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to complete task.",
            });
        }
    };


// ============================================================
// REOPEN TASK
// ============================================================

export const reopenTask =
    async (
        req,
        res
    ) => {
        try {
            const task =
                await WorkTask.findById(
                    req.params.taskId
                );

            if (!task) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Task not found.",
                });
            }

            const work =
                await Work.findById(
                    task.work
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canEditWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to reopen this task.",
                });
            }

            if (
                work.status ===
                "ARCHIVED"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Archived work is read-only.",
                });
            }

            // ------------------------------------------------
            // IMPORTANT:
            //
            // Locked work allows reopening.
            // It does NOT allow completing.
            // ------------------------------------------------

            const previousStatus =
                task.status;

            task.status =
                "INCOMPLETE";

            task.completed =
                false;

            task.completedAt =
                null;

            task.completedBy =
                null;

            task.updatedBy =
                req.user._id;

            await task.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "TASK_REOPENED",
                resourceType: "TASK",
                task:
                    task._id,
                description:
                    `Task "${task.title}" was reopened.`,
                metadata: {
                    before: {
                        status:
                            previousStatus,
                    },
                    after: {
                        status:
                            "INCOMPLETE",
                    },
                },
            });

            await syncWorkStatus(
                work._id,
                req.user
            );

            return res.json({
                success: true,
                message:
                    "Task reopened successfully.",
                data: {
                    task,
                    progress:
                        await calculateWorkProgress(
                            work._id
                        ),
                },
            });
        } catch (error) {
            console.error(
                "Reopen task error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to reopen task.",
            });
        }
    };


// ============================================================
// ARCHIVE TASK
// ============================================================

export const archiveTask =
    async (
        req,
        res
    ) => {
        try {
            const task =
                await WorkTask.findById(
                    req.params.taskId
                );

            if (!task) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Task not found.",
                });
            }

            const work =
                await Work.findById(
                    task.work
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canManageWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "Only the work creator or Superadmin can archive tasks.",
                });
            }

            if (
                work.status ===
                "ARCHIVED"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Archived work is read-only.",
                });
            }

            if (
                work.isLocked
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Locked work cannot have tasks archived.",
                });
            }

            task.status =
                "ARCHIVED";

            task.archivedAt =
                new Date();

            task.archivedBy =
                req.user._id;

            task.updatedBy =
                req.user._id;

            await task.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "TASK_ARCHIVED",
                resourceType: "TASK",
                task:
                    task._id,
                description:
                    `Task "${task.title}" was archived.`,
                metadata: {
                    archived:
                        true,
                },
            });

            await syncWorkStatus(
                work._id,
                req.user
            );

            return res.json({
                success: true,
                message:
                    "Task archived successfully.",
            });
        } catch (error) {
            console.error(
                "Archive task error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to archive task.",
            });
        }
    };


// ============================================================
// RESTORE TASK
// ============================================================

export const restoreTask =
    async (
        req,
        res
    ) => {
        try {
            const task =
                await WorkTask.findById(
                    req.params.taskId
                );

            if (!task) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Task not found.",
                });
            }

            const work =
                await Work.findById(
                    task.work
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canManageWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "Only the work creator or Superadmin can restore tasks.",
                });
            }

            if (
                work.status ===
                "ARCHIVED"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Archived work is read-only.",
                });
            }

            if (
                task.status !==
                "ARCHIVED"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Task is not archived.",
                });
            }

            task.status =
                task.completed
                    ? "COMPLETED"
                    : "INCOMPLETE";

            task.archivedAt =
                null;

            task.archivedBy =
                null;

            task.updatedBy =
                req.user._id;

            await task.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "TASK_RESTORED",
                resourceType: "TASK",
                task:
                    task._id,
                description:
                    `Task "${task.title}" was restored.`,
                metadata: {
                    archived:
                        false,
                },
            });

            await syncWorkStatus(
                work._id,
                req.user
            );

            return res.json({
                success: true,
                message:
                    "Task restored successfully.",
                data: {
                    task,
                    progress:
                        await calculateWorkProgress(
                            work._id
                        ),
                },
            });
        } catch (error) {
            console.error(
                "Restore task error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to restore task.",
            });
        }
    };


// ============================================================
// CREATE SUBTASK
// ============================================================

export const createSubtask =
    async (
        req,
        res
    ) => {
        try {
            const {
                taskId,
            } = req.params;

            const {
                title,
                description,
            } = req.body;

            const task =
                await WorkTask.findById(
                    taskId
                );

            if (!task) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Task not found.",
                });
            }

            const work =
                await Work.findById(
                    task.work
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canEditWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to add subtasks.",
                });
            }

            let check =
                ensureWorkEditable(
                    work
                );

            if (!check.allowed) {
                return res.status(409).json({
                    success: false,
                    message:
                        check.message,
                });
            }

            check =
                ensureWorkUnlocked(
                    work
                );

            if (!check.allowed) {
                return res.status(409).json({
                    success: false,
                    message:
                        check.message,
                });
            }

            if (
                !title?.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Subtask title is required.",
                });
            }

            const lastSubtask =
                await WorkSubtask.findOne({
                    task:
                        task._id,
                    status: {
                        $ne:
                            "ARCHIVED",
                    },
                }).sort({
                    order: -1,
                });

            const order =
                lastSubtask
                    ? lastSubtask.order + 1
                    : 0;

            const subtask =
                await WorkSubtask.create({
                    task:
                        task._id,

                    title:
                        title.trim(),

                    description:
                        description?.trim() ||
                        "",

                    completed:
                        false,

                    order,

                    createdBy:
                        req.user._id,

                    updatedBy:
                        req.user._id,
                });

            // Adding a subtask means completion is now derived
            // from subtasks. The new subtask starts incomplete,
            // so the task becomes/remains INCOMPLETE.

            task.status =
                "INCOMPLETE";

            task.completed =
                false;

            task.completedAt =
                null;

            task.completedBy =
                null;

            task.updatedBy =
                req.user._id;

            await task.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "SUBTASK_CREATED",
                resourceType: "SUBTASK",
                task:
                    task._id,
                subtask:
                    subtask._id,
                description:
                    `Subtask "${subtask.title}" was created.`,
                metadata: {
                    after: {
                        title:
                            subtask.title,
                        description:
                            subtask.description,
                    },
                },
            });

            await syncWorkStatus(
                work._id,
                req.user
            );

            return res.status(201).json({
                success: true,
                message:
                    "Subtask created successfully.",
                data: {
                    subtask,
                },
            });
        } catch (error) {
            console.error(
                "Create subtask error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to create subtask.",
            });
        }
    };


// ============================================================
// UPDATE SUBTASK
// ============================================================

export const updateSubtask =
    async (
        req,
        res
    ) => {
        try {
            const subtask =
                await WorkSubtask.findById(
                    req.params.subtaskId
                );

            if (!subtask) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Subtask not found.",
                });
            }

            const task =
                await WorkTask.findById(
                    subtask.task
                );

            const work =
                await Work.findById(
                    task.work
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canEditWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to edit this subtask.",
                });
            }

            let check =
                ensureWorkEditable(
                    work
                );

            if (!check.allowed) {
                return res.status(409).json({
                    success: false,
                    message:
                        check.message,
                });
            }

            check =
                ensureWorkUnlocked(
                    work
                );

            if (!check.allowed) {
                return res.status(409).json({
                    success: false,
                    message:
                        check.message,
                });
            }

            const before = {
                title:
                    subtask.title,

                description:
                    subtask.description,
            };

            if (
                req.body.title !==
                undefined
            ) {
                if (
                    !req.body.title?.trim()
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Subtask title cannot be empty.",
                    });
                }

                subtask.title =
                    req.body.title.trim();
            }

            if (
                req.body.description !==
                undefined
            ) {
                subtask.description =
                    req.body.description?.trim() ||
                    "";
            }

            subtask.updatedBy =
                req.user._id;

            await subtask.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "SUBTASK_UPDATED",
                resourceType: "SUBTASK",
                task:
                    task._id,
                subtask:
                    subtask._id,
                description:
                    `Subtask "${subtask.title}" was updated.`,
                metadata: {
                    before,
                    after: {
                        title:
                            subtask.title,
                        description:
                            subtask.description,
                    },
                },
            });

            return res.json({
                success: true,
                message:
                    "Subtask updated successfully.",
                data: {
                    subtask,
                },
            });
        } catch (error) {
            console.error(
                "Update subtask error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to update subtask.",
            });
        }
    };


// ============================================================
// COMPLETE SUBTASK
// ============================================================

export const completeSubtask =
    async (
        req,
        res
    ) => {
        try {
            const subtask =
                await WorkSubtask.findById(
                    req.params.subtaskId
                );

            if (!subtask) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Subtask not found.",
                });
            }

            const task =
                await WorkTask.findById(
                    subtask.task
                );

            const work =
                await Work.findById(
                    task.work
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canEditWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to complete this subtask.",
                });
            }

            if (
                work.status ===
                "ARCHIVED"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Archived work is read-only.",
                });
            }

            if (
                work.isLocked
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Locked work cannot have subtasks completed.",
                });
            }

            if (
                subtask.completed
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Subtask is already completed.",
                });
            }

            subtask.completed =
                true;

            subtask.completedAt =
                new Date();

            subtask.completedBy =
                req.user._id;

            subtask.updatedBy =
                req.user._id;

            await subtask.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "SUBTASK_COMPLETED",
                resourceType: "SUBTASK",
                task:
                    task._id,
                subtask:
                    subtask._id,
                description:
                    `Subtask "${subtask.title}" was completed.`,
                metadata: {
                    before: {
                        completed:
                            false,
                    },
                    after: {
                        completed:
                            true,
                    },
                },
            });

            await syncTaskStatus(
                task._id,
                req.user,
                work
            );

            await syncWorkStatus(
                work._id,
                req.user
            );

            return res.json({
                success: true,
                message:
                    "Subtask completed successfully.",
                data: {
                    subtask,
                    progress:
                        await calculateWorkProgress(
                            work._id
                        ),
                },
            });
        } catch (error) {
            console.error(
                "Complete subtask error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to complete subtask.",
            });
        }
    };


// ============================================================
// REOPEN SUBTASK
// ============================================================

export const reopenSubtask =
    async (
        req,
        res
    ) => {
        try {
            const subtask =
                await WorkSubtask.findById(
                    req.params.subtaskId
                );

            if (!subtask) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Subtask not found.",
                });
            }

            const task =
                await WorkTask.findById(
                    subtask.task
                );

            const work =
                await Work.findById(
                    task.work
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canEditWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to reopen this subtask.",
                });
            }

            if (
                work.status ===
                "ARCHIVED"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Archived work is read-only.",
                });
            }

            if (
                !subtask.completed
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Subtask is already incomplete.",
                });
            }

            subtask.completed =
                false;

            subtask.completedAt =
                null;

            subtask.completedBy =
                null;

            subtask.updatedBy =
                req.user._id;

            await subtask.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "SUBTASK_REOPENED",
                resourceType: "SUBTASK",
                task:
                    task._id,
                subtask:
                    subtask._id,
                description:
                    `Subtask "${subtask.title}" was reopened.`,
                metadata: {
                    before: {
                        completed:
                            true,
                    },
                    after: {
                        completed:
                            false,
                    },
                },
            });

            await syncTaskStatus(
                task._id,
                req.user,
                work
            );

            await syncWorkStatus(
                work._id,
                req.user
            );

            return res.json({
                success: true,
                message:
                    "Subtask reopened successfully.",
                data: {
                    subtask,
                    progress:
                        await calculateWorkProgress(
                            work._id
                        ),
                },
            });
        } catch (error) {
            console.error(
                "Reopen subtask error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to reopen subtask.",
            });
        }
    };


// ============================================================
// ARCHIVE SUBTASK
// ============================================================

export const archiveSubtask =
    async (
        req,
        res
    ) => {
        try {
            const subtask =
                await WorkSubtask.findById(
                    req.params.subtaskId
                );

            if (!subtask) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Subtask not found.",
                });
            }

            const task =
                await WorkTask.findById(
                    subtask.task
                );

            const work =
                await Work.findById(
                    task.work
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canManageWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "Only the work creator or Superadmin can archive subtasks.",
                });
            }

            if (
                work.status ===
                "ARCHIVED"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Archived work is read-only.",
                });
            }

            if (
                work.isLocked
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Locked work cannot have subtasks archived.",
                });
            }

            subtask.status =
                "ARCHIVED";

            subtask.archivedAt =
                new Date();

            subtask.archivedBy =
                req.user._id;

            subtask.updatedBy =
                req.user._id;

            await subtask.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "SUBTASK_ARCHIVED",
                resourceType: "SUBTASK",
                task:
                    task._id,
                subtask:
                    subtask._id,
                description:
                    `Subtask "${subtask.title}" was archived.`,
                metadata: {
                    archived:
                        true,
                },
            });

            await syncTaskStatus(
                task._id,
                req.user,
                work
            );

            await syncWorkStatus(
                work._id,
                req.user
            );

            return res.json({
                success: true,
                message:
                    "Subtask archived successfully.",
            });
        } catch (error) {
            console.error(
                "Archive subtask error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to archive subtask.",
            });
        }
    };


// ============================================================
// RESTORE SUBTASK
// ============================================================

export const restoreSubtask =
    async (
        req,
        res
    ) => {
        try {
            const subtask =
                await WorkSubtask.findById(
                    req.params.subtaskId
                );

            if (!subtask) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Subtask not found.",
                });
            }

            const task =
                await WorkTask.findById(
                    subtask.task
                );

            if (!task) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Task not found.",
                });
            }

            const work =
                await Work.findById(
                    task.work
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canManageWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "Only the work creator or Superadmin can restore subtasks.",
                });
            }

            if (
                work.status ===
                "ARCHIVED"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Archived work is read-only.",
                });
            }

            if (
                subtask.status !==
                "ARCHIVED"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Subtask is not archived.",
                });
            }

            subtask.status =
                subtask.completed
                    ? "COMPLETED"
                    : "INCOMPLETE";

            subtask.archivedAt =
                null;

            subtask.archivedBy =
                null;

            subtask.updatedBy =
                req.user._id;

            await subtask.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "SUBTASK_RESTORED",
                resourceType: "SUBTASK",
                task:
                    task._id,
                subtask:
                    subtask._id,
                description:
                    `Subtask "${subtask.title}" was restored.`,
                metadata: {
                    archived:
                        false,
                },
            });

            await syncTaskStatus(
                task._id,
                req.user,
                work
            );

            await syncWorkStatus(
                work._id,
                req.user
            );

            return res.json({
                success: true,
                message:
                    "Subtask restored successfully.",
                data: {
                    subtask,
                    progress:
                        await calculateWorkProgress(
                            work._id
                        ),
                },
            });
        } catch (error) {
            console.error(
                "Restore subtask error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to restore subtask.",
            });
        }
    };


// ============================================================
// REORDER WORKS
// ============================================================
//
// Only Superadmin + creator.
//
// Expected body:
//
// {
//     orderedIds: [
//         "workId1",
//         "workId2",
//         "workId3"
//     ]
// }
//

export const reorderWorks =
    async (
        req,
        res
    ) => {
        try {
            const {
                orderedIds,
            } = req.body;

            if (
                !Array.isArray(
                    orderedIds
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "orderedIds must be an array.",
                });
            }

            const works =
                await Work.find({
                    _id: {
                        $in:
                            orderedIds,
                    },
                    status: {
                        $ne:
                            "ARCHIVED",
                    },
                });

            for (
                let index = 0;
                index <
                orderedIds.length;
                index++
            ) {
                const work =
                    works.find(
                        (item) =>
                            item._id.toString() ===
                            orderedIds[
                            index
                            ]
                    );

                if (!work) {
                    continue;
                }

                if (
                    !canReorderWork(
                        work,
                        req.user
                    )
                ) {
                    return res.status(403).json({
                        success: false,
                        message:
                            "You can only reorder works you own.",
                    });
                }
            }

            const bulkOps =
                orderedIds.map(
                    (
                        id,
                        index
                    ) => ({
                        updateOne: {
                            filter: {
                                _id: id,
                            },
                            update: {
                                $set: {
                                    order:
                                        index,
                                    updatedBy:
                                        req.user._id,
                                },
                            },
                        },
                    })
                );

            if (
                bulkOps.length
            ) {
                await Work.bulkWrite(
                    bulkOps
                );
            }

            for (
                const id of orderedIds
            ) {
                const work =
                    works.find(
                        (item) =>
                            item._id.toString() ===
                            id
                    );

                if (work) {
                    await createActivity({
                        work,
                        admin:
                            req.user,
                        action:
                            "WORK_REORDERED",
                        resourceType: "WORK",
                        description:
                            `Work "${work.title}" was reordered.`,
                        metadata: {
                            order:
                                orderedIds.indexOf(
                                    id
                                ),
                        },
                    });
                }
            }

            return res.json({
                success: true,
                message:
                    "Works reordered successfully.",
            });
        } catch (error) {
            console.error(
                "Reorder works error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to reorder works.",
            });
        }
    };


// ============================================================
// REORDER TASKS
// ============================================================

export const reorderTasks =
    async (
        req,
        res
    ) => {
        try {
            const {
                orderedIds,
            } = req.body;

            const {
                workId,
            } = req.params;

            const work =
                await Work.findById(
                    workId
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canEditWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to reorder tasks.",
                });
            }

            if (
                work.status ===
                "ARCHIVED"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Archived work is read-only.",
                });
            }

            if (
                work.isLocked
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Locked work cannot reorder tasks.",
                });
            }

            if (
                !Array.isArray(
                    orderedIds
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "orderedIds must be an array.",
                });
            }

            const bulkOps =
                orderedIds.map(
                    (
                        id,
                        index
                    ) => ({
                        updateOne: {
                            filter: {
                                _id:
                                    id,
                                work:
                                    work._id,
                            },
                            update: {
                                $set: {
                                    order:
                                        index,
                                    updatedBy:
                                        req.user._id,
                                },
                            },
                        },
                    })
                );

            await WorkTask.bulkWrite(
                bulkOps
            );

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "TASK_REORDERED",
                resourceType: "TASK",
                description:
                    "Tasks were reordered.",
                metadata: {
                    orderedIds,
                },
            });

            return res.json({
                success: true,
                message:
                    "Tasks reordered successfully.",
            });
        } catch (error) {
            console.error(
                "Reorder tasks error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to reorder tasks.",
            });
        }
    };


// ============================================================
// REORDER SUBTASKS
// ============================================================

export const reorderSubtasks =
    async (
        req,
        res
    ) => {
        try {
            const {
                orderedIds,
            } = req.body;

            const {
                taskId,
            } = req.params;

            const task =
                await WorkTask.findById(
                    taskId
                );

            if (!task) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Task not found.",
                });
            }

            const work =
                await Work.findById(
                    task.work
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canEditWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to reorder subtasks.",
                });
            }

            if (
                work.status ===
                "ARCHIVED"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Archived work is read-only.",
                });
            }

            if (
                work.isLocked
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Locked work cannot reorder subtasks.",
                });
            }

            if (
                !Array.isArray(
                    orderedIds
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "orderedIds must be an array.",
                });
            }

            const bulkOps =
                orderedIds.map(
                    (
                        id,
                        index
                    ) => ({
                        updateOne: {
                            filter: {
                                _id:
                                    id,
                                task:
                                    task._id,
                            },
                            update: {
                                $set: {
                                    order:
                                        index,
                                    updatedBy:
                                        req.user._id,
                                },
                            },
                        },
                    })
                );

            await WorkSubtask.bulkWrite(
                bulkOps
            );

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "SUBTASK_REORDERED",
                resourceType: "SUBTASK",
                task:
                    task._id,
                description:
                    "Subtasks were reordered.",
                metadata: {
                    orderedIds,
                },
            });

            return res.json({
                success: true,
                message:
                    "Subtasks reordered successfully.",
            });
        } catch (error) {
            console.error(
                "Reorder subtasks error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to reorder subtasks.",
            });
        }
    };


// ============================================================
// GET WORK ACTIVITY
// ============================================================
//
// WorkActivity is immutable.
// This endpoint only reads it.
//

export const getWorkActivity =
    async (
        req,
        res
    ) => {
        try {
            const {
                workId,
            } = req.params;

            const work =
                await Work.findById(
                    workId
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            const activity =
                await WorkActivity.find({
                    work:
                        work._id,
                })
                    .populate(
                        "admin",
                        "username fullName role"
                    )
                    .populate(
                        "task",
                        "title"
                    )
                    .populate(
                        "subtask",
                        "title"
                    )
                    .sort({
                        createdAt:
                            -1,
                    });

            return res.json({
                success: true,
                data: {
                    activity,
                },
            });
        } catch (error) {
            console.error(
                "Get work activity error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to load work activity.",
            });
        }
    };


// ============================================================
// GET WORK COMMENTS
// ============================================================

export const getWorkComments =
    async (
        req,
        res
    ) => {
        try {
            const {
                workId,
            } = req.params;

            if (
                !isValidObjectId(
                    workId
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid work ID.",
                });
            }

            const work =
                await Work.findById(
                    workId
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            const comments =
                await WorkComment.find({
                    work:
                        work._id,
                })
                    .populate(
                        "admin",
                        "username fullName role"
                    )
                    .sort({
                        createdAt: 1,
                    });

            return res.json({
                success: true,
                data: {
                    comments,
                },
            });
        } catch (error) {
            console.error(
                "Get work comments error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to load comments.",
            });
        }
    };


// ============================================================
// CREATE WORK COMMENT
// ============================================================

export const createWorkComment =
    async (
        req,
        res
    ) => {
        try {
            const {
                workId,
            } = req.params;

            const {
                description,
            } = req.body;

            const work =
                await Work.findById(
                    workId
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                work.status ===
                "ARCHIVED"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Archived work is read-only.",
                });
            }

            if (
                !description?.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Comment cannot be empty.",
                });
            }

            const comment =
                await WorkComment.create({
                    work:
                        work._id,

                    admin:
                        req.user._id,

                    description:
                        description.trim(),
                });

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "COMMENT_CREATED",
                resourceType: "COMMENT",
                description:
                    "A comment was added.",
                metadata: {
                    resourceId:
                        comment._id,
                    after: {
                        description:
                            comment.description,
                    },
                },
            });

            await comment.populate(
                "admin",
                "username fullName role"
            );

            return res.status(201).json({
                success: true,
                message:
                    "Comment added successfully.",
                data: {
                    comment,
                },
            });
        } catch (error) {
            console.error(
                "Create work comment error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to add comment.",
            });
        }
    };


// ============================================================
// UPDATE WORK COMMENT
// ============================================================

export const updateWorkComment =
    async (
        req,
        res
    ) => {
        try {
            const {
                commentId,
            } = req.params;

            const {
                description,
            } = req.body;

            const comment =
                await WorkComment.findById(
                    commentId
                );

            if (!comment) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Comment not found.",
                });
            }

            const isAuthor =
                comment.admin.toString() ===
                req.user._id.toString();

            if (
                !isAuthor &&
                !isSuperAdmin(
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to edit this comment.",
                });
            }

            if (
                !description?.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Comment cannot be empty.",
                });
            }

            const work =
                await Work.findById(
                    comment.work
                );

            const before = {
                description:
                    comment.description,
            };

            comment.description =
                description.trim();

            await comment.save();

            if (work) {
                await createActivity({
                    work,
                    admin:
                        req.user,
                    action:
                        "COMMENT_UPDATED",
                    resourceType: "COMMENT",
                    description:
                        "A comment was updated.",
                    metadata: {
                        resourceId:
                            comment._id,
                        before,
                        after: {
                            description:
                                comment.description,
                        },
                    },
                });
            }

            await comment.populate(
                "admin",
                "username fullName role"
            );

            return res.json({
                success: true,
                message:
                    "Comment updated successfully.",
                data: {
                    comment,
                },
            });
        } catch (error) {
            console.error(
                "Update work comment error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to update comment.",
            });
        }
    };


// ============================================================
// DELETE WORK COMMENT
// ============================================================

export const deleteWorkComment =
    async (
        req,
        res
    ) => {
        try {
            const {
                commentId,
            } = req.params;

            const comment =
                await WorkComment.findById(
                    commentId
                );

            if (!comment) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Comment not found.",
                });
            }

            const isAuthor =
                comment.admin.toString() ===
                req.user._id.toString();

            if (
                !isAuthor &&
                !isSuperAdmin(
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to delete this comment.",
                });
            }

            const work =
                await Work.findById(
                    comment.work
                );

            await WorkComment.findByIdAndDelete(
                commentId
            );

            if (work) {
                await createActivity({
                    work,
                    admin:
                        req.user,
                    action:
                        "COMMENT_DELETED",
                    resourceType: "COMMENT",
                    description:
                        "A comment was deleted.",
                    metadata: {
                        resourceId:
                            commentId,
                        before: {
                            description:
                                comment.description,
                        },
                    },
                });
            }

            return res.json({
                success: true,
                message:
                    "Comment deleted successfully.",
            });
        } catch (error) {
            console.error(
                "Delete work comment error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to delete comment.",
            });
        }
    };


// ============================================================
// GET WORK LINKS
// ============================================================

export const getWorkLinks =
    async (
        req,
        res
    ) => {
        try {
            const {
                workId,
            } = req.params;

            if (
                !isValidObjectId(
                    workId
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid work ID.",
                });
            }

            const work =
                await Work.findById(
                    workId
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            const links =
                await WorkLink.find({
                    work:
                        work._id,
                })
                    .populate(
                        "createdBy",
                        "username fullName"
                    )
                    .sort({
                        createdAt: 1,
                    });

            return res.json({
                success: true,
                data: {
                    links,
                },
            });
        } catch (error) {
            console.error(
                "Get work links error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to load links.",
            });
        }
    };


// ============================================================
// CREATE WORK LINK
// ============================================================

export const createWorkLink =
    async (
        req,
        res
    ) => {
        try {
            const {
                workId,
            } = req.params;

            const {
                title,
                url,
                description,
            } = req.body;

            const work =
                await Work.findById(
                    workId
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canEditWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to add links.",
                });
            }

            let check =
                ensureWorkEditable(
                    work
                );

            if (!check.allowed) {
                return res.status(409).json({
                    success: false,
                    message:
                        check.message,
                });
            }

            check =
                ensureWorkUnlocked(
                    work
                );

            if (!check.allowed) {
                return res.status(409).json({
                    success: false,
                    message:
                        check.message,
                });
            }

            if (
                !title?.trim()
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Link title is required.",
                });
            }

            if (
                !isValidHttpsUrl(
                    url
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Please provide a valid HTTPS URL.",
                });
            }

            const link =
                await WorkLink.create({
                    work:
                        work._id,

                    title:
                        title.trim(),

                    url:
                        url.trim(),

                    description:
                        description?.trim() ||
                        "",

                    createdBy:
                        req.user._id,

                    updatedBy:
                        req.user._id,
                });

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "LINK_CREATED",
                resourceType: "LINK",
                description:
                    `Link "${link.title}" was added.`,
                metadata: {
                    resourceId:
                        link._id,
                    after: {
                        title:
                            link.title,
                        url:
                            link.url,
                    },
                },
            });

            await link.populate(
                "createdBy",
                "username fullName"
            );

            return res.status(201).json({
                success: true,
                message:
                    "Link added successfully.",
                data: {
                    link,
                },
            });
        } catch (error) {
            console.error(
                "Create work link error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to add link.",
            });
        }
    };


// ============================================================
// UPDATE WORK LINK
// ============================================================

export const updateWorkLink =
    async (
        req,
        res
    ) => {
        try {
            const {
                linkId,
            } = req.params;

            const link =
                await WorkLink.findById(
                    linkId
                );

            if (!link) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Link not found.",
                });
            }

            const work =
                await Work.findById(
                    link.work
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canEditWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to edit this link.",
                });
            }

            let check =
                ensureWorkEditable(
                    work
                );

            if (!check.allowed) {
                return res.status(409).json({
                    success: false,
                    message:
                        check.message,
                });
            }

            check =
                ensureWorkUnlocked(
                    work
                );

            if (!check.allowed) {
                return res.status(409).json({
                    success: false,
                    message:
                        check.message,
                });
            }

            const before = {
                title:
                    link.title,

                url:
                    link.url,

                description:
                    link.description,
            };

            if (
                req.body.title !==
                undefined
            ) {
                if (
                    !req.body.title?.trim()
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Link title cannot be empty.",
                    });
                }

                link.title =
                    req.body.title.trim();
            }

            if (
                req.body.url !==
                undefined
            ) {
                if (
                    !isValidHttpsUrl(
                        req.body.url
                    )
                ) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Please provide a valid HTTPS URL.",
                    });
                }

                link.url =
                    req.body.url.trim();
            }

            if (
                req.body.description !==
                undefined
            ) {
                link.description =
                    req.body.description?.trim() ||
                    "";
            }

            link.updatedBy =
                req.user._id;

            await link.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "LINK_UPDATED",
                resourceType: "LINK",
                description:
                    `Link "${link.title}" was updated.`,
                metadata: {
                    resourceId:
                        link._id,
                    before,
                    after: {
                        title:
                            link.title,
                        url:
                            link.url,
                        description:
                            link.description,
                    },
                },
            });

            await link.populate(
                "createdBy",
                "username fullName"
            );

            return res.json({
                success: true,
                message:
                    "Link updated successfully.",
                data: {
                    link,
                },
            });
        } catch (error) {
            console.error(
                "Update work link error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to update link.",
            });
        }
    };


// ============================================================
// DELETE WORK LINK
// ============================================================

export const deleteWorkLink =
    async (
        req,
        res
    ) => {
        try {
            const {
                linkId,
            } = req.params;

            const link =
                await WorkLink.findById(
                    linkId
                );

            if (!link) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Link not found.",
                });
            }

            const work =
                await Work.findById(
                    link.work
                );

            if (!work) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Work not found.",
                });
            }

            if (
                !canEditWork(
                    work,
                    req.user
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to remove this link.",
                });
            }

            let check =
                ensureWorkEditable(
                    work
                );

            if (!check.allowed) {
                return res.status(409).json({
                    success: false,
                    message:
                        check.message,
                });
            }

            check =
                ensureWorkUnlocked(
                    work
                );

            if (!check.allowed) {
                return res.status(409).json({
                    success: false,
                    message:
                        check.message,
                });
            }

            await WorkLink.findByIdAndDelete(
                linkId
            );

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "LINK_DELETED",
                resourceType: "LINK",
                description:
                    `Link "${link.title}" was removed.`,
                metadata: {
                    resourceId:
                        linkId,
                    before: {
                        title:
                            link.title,
                        url:
                            link.url,
                    },
                },
            });

            return res.json({
                success: true,
                message:
                    "Link removed successfully.",
            });
        } catch (error) {
            console.error(
                "Delete work link error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to remove link.",
            });
        }
    };