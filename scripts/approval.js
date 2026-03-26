/**
 * Multi-level approval flow — submit, approve, reject, status.
 */
const workflow = require("./workflow");
const permissions = require("./permissions");

let PrismaClientCtor = null;
try { PrismaClientCtor = require("@prisma/client").PrismaClient; } catch (_) {}
let prismaClient = null;
function getPrisma() {
  if (!PrismaClientCtor) throw new Error("Prisma not installed.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set.");
  if (!prismaClient) prismaClient = new PrismaClientCtor();
  return prismaClient;
}

/**
 * Submit a template for approval through a chain.
 */
async function submitForApproval(templateId, chainId, userId, reviewerOverrides) {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const template = await tx.template.findUnique({ where: { id: templateId } });
    if (!template) throw Object.assign(new Error("Template not found."), { statusCode: 404 });
    if (template.status !== "DRAFT") throw Object.assign(new Error("Only DRAFT templates can be submitted."), { statusCode: 409 });

    const chain = await tx.approvalChain.findUnique({
      where: { id: chainId },
      include: { levels: { orderBy: { levelOrder: "asc" } } }
    });
    if (!chain || !chain.active) throw Object.assign(new Error("Approval chain not found or inactive."), { statusCode: 404 });
    if (chain.levels.length === 0) throw Object.assign(new Error("Approval chain has no levels."), { statusCode: 400 });

    // Cancel any existing in-progress requests for this template
    await tx.approvalRequest.updateMany({
      where: { templateId, status: "IN_PROGRESS" },
      data: { status: "CANCELLED" }
    });

    // Create approval request
    const request = await tx.approvalRequest.create({
      data: {
        templateId,
        chainId,
        currentLevel: 1,
        status: "IN_PROGRESS",
        submittedBy: userId
      }
    });

    // Create first step
    const firstLevel = chain.levels[0];
    const assigneeId = (reviewerOverrides && reviewerOverrides[1]) || firstLevel.defaultUserId;
    if (!assigneeId) throw Object.assign(new Error("No approver assigned for Step 1. Select an approver or configure a default."), { statusCode: 400 });

    await tx.approvalStep.create({
      data: {
        requestId: request.id,
        levelOrder: 1,
        assigneeId
      }
    });

    // Transition template to REVIEW
    await tx.template.update({
      where: { id: templateId },
      data: { status: "REVIEW", updatedBy: userId }
    });

    // Audit
    await tx.auditEvent.create({
      data: {
        templateId,
        action: "template.submitted",
        actorId: userId,
        metadata: { chainId, chainName: chain.name, assigneeId }
      }
    });

    return tx.approvalRequest.findUnique({
      where: { id: request.id },
      include: { steps: { orderBy: { levelOrder: "asc" }, include: { assignee: { select: { id: true, name: true, email: true, role: true } } } }, chain: { include: { levels: { orderBy: { levelOrder: "asc" } } } } }
    });
  });
}

/**
 * Approve the current pending step.
 */
async function approveStep(templateId, userId, comment) {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    const request = await tx.approvalRequest.findFirst({
      where: { templateId, status: "IN_PROGRESS" },
      include: {
        steps: { orderBy: { levelOrder: "asc" }, include: { assignee: { select: { id: true, name: true, role: true } } } },
        chain: { include: { levels: { orderBy: { levelOrder: "asc" } } } }
      }
    });
    if (!request) throw Object.assign(new Error("No active approval request."), { statusCode: 404 });

    // Find current pending step
    const pendingStep = request.steps.find((s) => s.status === "PENDING");
    if (!pendingStep) throw Object.assign(new Error("No pending step to approve."), { statusCode: 409 });

    // Verify user is the assignee
    if (pendingStep.assigneeId !== userId) {
      throw Object.assign(new Error("You are not the assigned approver for this step."), { statusCode: 403 });
    }

    // Mark step as approved
    await tx.approvalStep.update({
      where: { id: pendingStep.id },
      data: { status: "APPROVED", comment: comment || null, decidedAt: new Date() }
    });

    // Check if there are more levels
    const nextLevelOrder = pendingStep.levelOrder + 1;
    const nextLevel = request.chain.levels.find((l) => l.levelOrder === nextLevelOrder);

    if (nextLevel) {
      // More levels — create next step, increment currentLevel
      const nextAssigneeId = nextLevel.defaultUserId;
      if (!nextAssigneeId) throw Object.assign(new Error(`No default approver for Step ${nextLevelOrder}. Configure one in the approval chain.`), { statusCode: 400 });

      await tx.approvalStep.create({
        data: {
          requestId: request.id,
          levelOrder: nextLevelOrder,
          assigneeId: nextAssigneeId
        }
      });

      await tx.approvalRequest.update({
        where: { id: request.id },
        data: { currentLevel: nextLevelOrder }
      });
    } else {
      // Last level — mark request approved, transition template
      await tx.approvalRequest.update({
        where: { id: request.id },
        data: { status: "APPROVED" }
      });

      // Check if final level role is PUBLISHER → auto-publish, else just APPROVED
      const finalLevel = request.chain.levels[request.chain.levels.length - 1];
      const newStatus = finalLevel.requiredRole === "PUBLISHER" ? "PUBLISHED" : "APPROVED";

      await tx.template.update({
        where: { id: templateId },
        data: { status: newStatus, updatedBy: userId }
      });
    }

    // Audit
    await tx.auditEvent.create({
      data: {
        templateId,
        action: "template.step.approved",
        actorId: userId,
        reason: comment || null,
        metadata: { levelOrder: pendingStep.levelOrder, chainName: request.chain.name }
      }
    });
  });

  return getApprovalStatus(templateId);
}

/**
 * Reject the current pending step — sends template back to DRAFT.
 */
async function rejectStep(templateId, userId, reason) {
  const prisma = getPrisma();
  if (!reason) throw Object.assign(new Error("A reason is required for rejection."), { statusCode: 400 });

  await prisma.$transaction(async (tx) => {
    const request = await tx.approvalRequest.findFirst({
      where: { templateId, status: "IN_PROGRESS" },
      include: {
        steps: { orderBy: { levelOrder: "asc" }, include: { assignee: { select: { id: true, name: true, role: true } } } },
        chain: { include: { levels: { orderBy: { levelOrder: "asc" } } } }
      }
    });
    if (!request) throw Object.assign(new Error("No active approval request."), { statusCode: 404 });

    const pendingStep = request.steps.find((s) => s.status === "PENDING");
    if (!pendingStep) throw Object.assign(new Error("No pending step to reject."), { statusCode: 409 });
    if (pendingStep.assigneeId !== userId) {
      throw Object.assign(new Error("You are not the assigned approver for this step."), { statusCode: 403 });
    }

    // Mark step rejected
    await tx.approvalStep.update({
      where: { id: pendingStep.id },
      data: { status: "REJECTED", comment: reason, decidedAt: new Date() }
    });

    // Mark request rejected
    await tx.approvalRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED" }
    });

    // Template back to DRAFT
    await tx.template.update({
      where: { id: templateId },
      data: { status: "DRAFT", updatedBy: userId }
    });

    // Audit
    await tx.auditEvent.create({
      data: {
        templateId,
        action: "template.step.rejected",
        actorId: userId,
        reason,
        metadata: { levelOrder: pendingStep.levelOrder, chainName: request.chain.name }
      }
    });
  });

  return getApprovalStatus(templateId);
}

/**
 * Get full approval status for a template.
 */
async function getApprovalStatus(templateId) {
  const prisma = getPrisma();
  const template = await prisma.template.findUnique({
    where: { id: templateId },
    select: { id: true, name: true, status: true, projectId: true }
  });
  if (!template) return null;

  const request = await prisma.approvalRequest.findFirst({
    where: { templateId },
    orderBy: { createdAt: "desc" },
    include: {
      steps: {
        orderBy: { levelOrder: "asc" },
        include: { assignee: { select: { id: true, name: true, email: true, role: true } } }
      },
      chain: {
        include: { levels: { orderBy: { levelOrder: "asc" } } }
      }
    }
  });

  return {
    template,
    request: request || null,
    chainLevels: request ? request.chain.levels : [],
    steps: request ? request.steps : [],
    currentLevel: request ? request.currentLevel : 0,
    status: request ? request.status : null
  };
}

/**
 * List templates pending a user's review.
 */
async function listPendingReviews(userId) {
  const prisma = getPrisma();
  const pendingSteps = await prisma.approvalStep.findMany({
    where: { assigneeId: userId, status: "PENDING" },
    include: {
      request: {
        include: {
          template: { select: { id: true, name: true, status: true, projectId: true } },
          chain: { select: { name: true } }
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  return pendingSteps
    .filter((s) => s.request.status === "IN_PROGRESS")
    .map((s) => ({
      templateId: s.request.template.id,
      templateName: s.request.template.name,
      chainName: s.request.chain.name,
      levelOrder: s.levelOrder,
      stepId: s.id,
      createdAt: s.createdAt
    }));
}

module.exports = {
  submitForApproval,
  approveStep,
  rejectStep,
  getApprovalStatus,
  listPendingReviews,
};
