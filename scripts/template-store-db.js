let PrismaClientCtor = null;
try {
  PrismaClientCtor = require("@prisma/client").PrismaClient;
} catch (err) {
  PrismaClientCtor = null;
}

let prismaClient = null;

function getPrisma() {
  if (!PrismaClientCtor) {
    throw new Error("Prisma client not installed. Run: npm install");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set.");
  }
  if (!prismaClient) {
    prismaClient = new PrismaClientCtor();
  }
  return prismaClient;
}

function canUseDb() {
  return Boolean(PrismaClientCtor && process.env.DATABASE_URL);
}

async function listTemplates() {
  const prisma = getPrisma();
  return prisma.template.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      currentVersionId: true,
      createdBy: true,
      updatedBy: true,
      createdAt: true,
      updatedAt: true,
      currentVersion: {
        select: {
          id: true,
          version: true,
          createdAt: true
        }
      }
    }
  });
}

async function getTemplate(templateId) {
  const prisma = getPrisma();
  return prisma.template.findUnique({
    where: { id: templateId },
    include: {
      currentVersion: true
    }
  });
}

async function listTemplateVersions(templateId) {
  const prisma = getPrisma();
  return prisma.templateVersion.findMany({
    where: { templateId },
    orderBy: { version: "desc" }
  });
}

async function listTemplateAudit(templateId, limit = 100) {
  const prisma = getPrisma();
  return prisma.auditEvent.findMany({
    where: { templateId },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(Number(limit) || 100, 500))
  });
}

async function createTemplate(input) {
  const prisma = getPrisma();
  const name = String(input && input.name ? input.name : "").trim();
  const contentJson = input && input.contentJson ? input.contentJson : {};
  const description = input && input.description ? String(input.description) : null;
  const actorId = input && input.actorId ? String(input.actorId) : "system";

  if (!name) {
    throw new Error("Template name is required.");
  }

  return prisma.$transaction(async (tx) => {
    const template = await tx.template.create({
      data: {
        name,
        description,
        createdBy: actorId,
        updatedBy: actorId
      }
    });

    const version = await tx.templateVersion.create({
      data: {
        templateId: template.id,
        version: 1,
        contentJson,
        createdBy: actorId
      }
    });

    const updated = await tx.template.update({
      where: { id: template.id },
      data: {
        currentVersionId: version.id,
        updatedBy: actorId
      },
      include: {
        currentVersion: true
      }
    });

    await tx.auditEvent.create({
      data: {
        templateId: template.id,
        versionId: version.id,
        action: "template.created",
        actorId,
        afterJson: contentJson
      }
    });

    return updated;
  });
}

async function createTemplateVersion(templateId, input) {
  const prisma = getPrisma();
  const contentJson = input && input.contentJson ? input.contentJson : {};
  const actorId = input && input.actorId ? String(input.actorId) : "system";

  return prisma.$transaction(async (tx) => {
    const previous = await tx.template.findUnique({
      where: { id: templateId },
      include: { currentVersion: true }
    });

    if (!previous) {
      throw new Error("Template not found.");
    }

    const latest = await tx.templateVersion.findFirst({
      where: { templateId },
      orderBy: { version: "desc" }
    });

    const nextVersion = (latest ? latest.version : 0) + 1;

    const version = await tx.templateVersion.create({
      data: {
        templateId,
        version: nextVersion,
        contentJson,
        createdBy: actorId
      }
    });

    const updated = await tx.template.update({
      where: { id: templateId },
      data: {
        currentVersionId: version.id,
        updatedBy: actorId
      },
      include: {
        currentVersion: true
      }
    });

    await tx.auditEvent.create({
      data: {
        templateId,
        versionId: version.id,
        action: "template.version.created",
        actorId,
        beforeJson: previous.currentVersion ? previous.currentVersion.contentJson : null,
        afterJson: contentJson
      }
    });

    return updated;
  });
}

async function updateTemplateMetadata(templateId, input) {
  const prisma = getPrisma();
  const actorId = input && input.actorId ? String(input.actorId) : "system";
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(input || {}, "name")) {
    const nextName = String(input.name || "").trim();
    if (!nextName) {
      throw new Error("Template name cannot be empty.");
    }
    patch.name = nextName;
  }
  if (Object.prototype.hasOwnProperty.call(input || {}, "description")) {
    patch.description = input.description ? String(input.description) : null;
  }
  if (Object.prototype.hasOwnProperty.call(input || {}, "status")) {
    patch.status = String(input.status || "").toUpperCase();
  }
  patch.updatedBy = actorId;

  const previous = await prisma.template.findUnique({ where: { id: templateId } });
  if (!previous) {
    throw new Error("Template not found.");
  }

  const updated = await prisma.template.update({
    where: { id: templateId },
    data: patch,
    include: {
      currentVersion: true
    }
  });

  await prisma.auditEvent.create({
    data: {
      templateId,
      versionId: updated.currentVersionId || null,
      action: "template.metadata.updated",
      actorId,
      beforeJson: {
        name: previous.name,
        description: previous.description,
        status: previous.status
      },
      afterJson: {
        name: updated.name,
        description: updated.description,
        status: updated.status
      }
    }
  });

  return updated;
}

module.exports = {
  canUseDb,
  listTemplates,
  getTemplate,
  listTemplateVersions,
  listTemplateAudit,
  createTemplate,
  createTemplateVersion,
  updateTemplateMetadata
};
