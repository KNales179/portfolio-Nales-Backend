import mongoose from "mongoose";

import Work from "../models/Work.js";
import WorkTask from "../models/WorkTask.js";
import WorkSubtask from "../models/WorkSubtask.js";
import WorkActivity from "../models/WorkActivity.js";


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
    if (work.locked) {
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


// ============================================================
// ACTIVITY LOGGER
// ============================================================

const createActivity = async ({
    work,
    admin,
    action,
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

    const anyCompleted =
        subtasks.some(
            (subtask) =>
                subtask.completed
        );

    let newStatus;

    if (allCompleted) {
        newStatus = "COMPLETED";
    } else if (anyCompleted) {
        newStatus = "IN_PROGRESS";
    } else {
        newStatus = "PENDING";
    }

    if (
        task.status !==
        newStatus
    ) {
        const previousStatus =
            task.status;

        task.status =
            newStatus;

        task.updatedBy =
            admin._id;

        await task.save();

        await createActivity({
            work,
            admin,
            action:
                "TASK_STATUS_CHANGED",
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

    if (progress === 0) {
        work.status =
            "PLANNED";
    } else if (progress === 100) {
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
                "WORK_STATUS_CHANGED",
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

                    participants: 
                        req.user._id,
                });

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "WORK_CREATED",
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
                    "WORK_STATUS_CHANGED",
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
                    "WORK_STATUS_CHANGED",
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

            if (work.locked) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Work is already locked.",
                });
            }

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

            if (!work.locked) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Work is not locked.",
                });
            }

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
                    "WORK_OWNERSHIP_TRANSFERRED",
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
                        "PENDING",

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
                work.locked
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

            task.updatedBy =
                req.user._id;

            await task.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "TASK_STATUS_CHANGED",
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
                "PENDING";

            task.updatedBy =
                req.user._id;

            await task.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "TASK_STATUS_CHANGED",
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
                            "PENDING",
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
                work.locked
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Locked work cannot have tasks archived.",
                });
            }

            task.status =
                "ARCHIVED";

            task.updatedBy =
                req.user._id;

            await task.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "TASK_DELETED",
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

            // Adding a subtask to a task
            // means its completion is now
            // controlled by subtasks.

            task.status =
                "IN_PROGRESS";

            task.updatedBy =
                req.user._id;

            await task.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "SUBTASK_CREATED",
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
                work.locked
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
                    "SUBTASK_UNCOMPLETED",
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
                work.locked
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "Locked work cannot have subtasks archived.",
                });
            }

            subtask.status =
                "ARCHIVED";

            subtask.updatedBy =
                req.user._id;

            await subtask.save();

            await createActivity({
                work,
                admin:
                    req.user,
                action:
                    "SUBTASK_DELETED",
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
                work.locked
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
                work.locked
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