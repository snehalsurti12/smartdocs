/**
 * Project management — CRUD, membership.
 */
let PrismaClientCtor = null;
try { PrismaClientCtor = require("@prisma/client").PrismaClient; } catch (_) {}
let prismaClient = null;
function getPrisma() {
  if (!PrismaClientCtor) throw new Error("Prisma not installed.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set.");
  if (!prismaClient) prismaClient = new PrismaClientCtor();
  return prismaClient;
}

async function listProjects(tenantId, userId, role) {
  const prisma = getPrisma();
  if (role === "ADMIN") {
    return prisma.project.findMany({
      where: { tenantId, active: true },
      include: { members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } }, _count: { select: { templates: true } } },
      orderBy: { name: "asc" }
    });
  }
  // Non-admin: only projects they belong to
  return prisma.project.findMany({
    where: { tenantId, active: true, members: { some: { userId } } },
    include: { members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } }, _count: { select: { templates: true } } },
    orderBy: { name: "asc" }
  });
}

async function getProject(projectId) {
  const prisma = getPrisma();
  return prisma.project.findUnique({
    where: { id: projectId },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
      approvalChains: { where: { active: true }, include: { levels: { orderBy: { levelOrder: "asc" } } } },
      _count: { select: { templates: true } }
    }
  });
}

async function createProject(tenantId, name, description, creatorId) {
  const prisma = getPrisma();
  name = (name || "").trim();
  if (!name) throw Object.assign(new Error("Project name is required."), { statusCode: 400 });

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: { tenantId, name, description: description || null }
    });
    // Auto-add creator as member
    await tx.projectMember.create({
      data: { projectId: project.id, userId: creatorId }
    });
    return project;
  });
}

async function updateProject(projectId, updates) {
  const prisma = getPrisma();
  const patch = {};
  if (updates.name !== undefined) {
    const n = (updates.name || "").trim();
    if (!n) throw Object.assign(new Error("Project name cannot be empty."), { statusCode: 400 });
    patch.name = n;
  }
  if (updates.description !== undefined) patch.description = updates.description || null;
  if (typeof updates.active === "boolean") patch.active = updates.active;
  return prisma.project.update({ where: { id: projectId }, data: patch });
}

async function addMember(projectId, userId) {
  const prisma = getPrisma();
  const existing = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
  if (existing) throw Object.assign(new Error("User is already a member."), { statusCode: 409 });
  return prisma.projectMember.create({ data: { projectId, userId } });
}

async function removeMember(projectId, userId) {
  const prisma = getPrisma();
  return prisma.projectMember.delete({ where: { projectId_userId: { projectId, userId } } });
}

// ── Approval Chains ──

async function listApprovalChains(projectId) {
  const prisma = getPrisma();
  return prisma.approvalChain.findMany({
    where: { projectId },
    include: { levels: { orderBy: { levelOrder: "asc" } } },
    orderBy: { name: "asc" }
  });
}

async function saveApprovalChain(projectId, name, levels) {
  const prisma = getPrisma();
  name = (name || "").trim();
  if (!name) throw Object.assign(new Error("Chain name is required."), { statusCode: 400 });
  if (!Array.isArray(levels) || levels.length === 0) throw Object.assign(new Error("At least one approval level is required."), { statusCode: 400 });

  return prisma.$transaction(async (tx) => {
    // Upsert: find existing chain by name for this project
    let chain = await tx.approvalChain.findUnique({ where: { projectId_name: { projectId, name } } });
    if (chain) {
      // Delete old levels and recreate
      await tx.approvalChainLevel.deleteMany({ where: { chainId: chain.id } });
    } else {
      chain = await tx.approvalChain.create({ data: { projectId, name } });
    }
    // Create levels
    for (let i = 0; i < levels.length; i++) {
      const lvl = levels[i];
      await tx.approvalChainLevel.create({
        data: {
          chainId: chain.id,
          levelOrder: i + 1,
          label: lvl.label || `Step ${i + 1}`,
          requiredRole: lvl.requiredRole || "REVIEWER",
          defaultUserId: lvl.defaultUserId || null
        }
      });
    }
    return tx.approvalChain.findUnique({
      where: { id: chain.id },
      include: { levels: { orderBy: { levelOrder: "asc" } } }
    });
  });
}

async function deleteApprovalChain(chainId) {
  const prisma = getPrisma();
  return prisma.approvalChain.update({ where: { id: chainId }, data: { active: false } });
}

module.exports = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  addMember,
  removeMember,
  listApprovalChains,
  saveApprovalChain,
  deleteApprovalChain,
};
