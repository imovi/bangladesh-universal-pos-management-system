import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import {
  MODULE_KEYS,
  MODULE_INFO,
  findMissingDependencies,
  type ModuleKey,
} from "@universal-pos/shared";
import { v7 as uuidv7 } from "uuid";

@Injectable()
export class ModulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getModulesForTenant(tenantId: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const flags = await tx.featureFlag.findMany({
        where: { key: { startsWith: "module." } },
      });

      const flagMap = new Map<string, { allowed: boolean; enabled: boolean }>();
      for (const f of flags) {
        flagMap.set(f.key.replace(/^module\./, ""), {
          allowed: f.allowed,
          enabled: f.enabled,
        });
      }

      return MODULE_KEYS.map((key) => {
        const info = MODULE_INFO[key];
        const state = flagMap.get(key) || { allowed: false, enabled: false };
        const active = Boolean(state.allowed && state.enabled);
        return {
          key,
          allowed: state.allowed,
          enabled: state.enabled,
          active,
          nameBn: info?.nameBn || key,
          nameEn: info?.nameEn || key,
          description: info?.descriptionBn || "",
          dependsOn: info?.dependsOn || [],
        };
      });
    });
  }

  async getActiveModuleKeysForTenant(tenantId: string): Promise<ModuleKey[]> {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const flags = await tx.featureFlag.findMany({
        where: {
          key: { startsWith: "module." },
          allowed: true,
          enabled: true,
        },
        select: { key: true },
      });
      return flags
        .map((f) => f.key.replace(/^module\./, "") as ModuleKey)
        .filter((k) => MODULE_KEYS.includes(k));
    });
  }

  async updateModuleEnabled(
    tenantId: string,
    key: string,
    enabled: boolean,
    actorUserId: string,
  ) {
    if (!MODULE_KEYS.includes(key as ModuleKey)) {
      throw new BadRequestException({
        code: "INVALID_MODULE_KEY",
        message: `Unknown module key: ${key}`,
      });
    }

    const moduleKey = key as ModuleKey;
    const flagKey = `module.${moduleKey}`;

    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      // Read all tenant module flags
      const flags = await tx.featureFlag.findMany({
        where: { key: { startsWith: "module." } },
      });

      const targetFlag = flags.find((f) => f.key === flagKey);
      if (!targetFlag || !targetFlag.allowed) {
        throw new ForbiddenException({
          code: "MODULE_NOT_ALLOWED",
          message: "এই মডিউলটি আপনার দোকানের জন্য প্ল্যাটফর্ম থেকে অনুমোদিত নয়।",
        });
      }

      const activeKeys = flags
        .filter((f) => f.allowed && f.enabled)
        .map((f) => f.key.replace(/^module\./, "") as ModuleKey);

      if (enabled) {
        // Check dependencies
        const missing = findMissingDependencies(activeKeys, moduleKey);
        if (missing.length > 0) {
          const missingNames = missing.map((m) => MODULE_INFO[m]?.nameBn || m).join(", ");
          throw new ConflictException({
            code: "MODULE_DEPENDENCY_MISSING",
            message: `এই মডিউলটি চালু করার আগে নিম্নলিখিত মডিউলগুলো চালু থাকতে হবে: ${missingNames}`,
            missingModules: missing,
          });
        }
      } else {
        // Check if any currently active module depends on this module
        const dependents = activeKeys.filter((k) => {
          if (k === moduleKey) return false;
          return MODULE_INFO[k]?.dependsOn?.includes(moduleKey);
        });
        if (dependents.length > 0) {
          const depNames = dependents.map((d) => MODULE_INFO[d]?.nameBn || d).join(", ");
          throw new ConflictException({
            code: "MODULE_IN_USE_BY_DEPENDENT",
            message: `এই মডিউলটি বন্ধ করা যাবে না কারণ এটি ${depNames} মডিউলে ব্যবহৃত হচ্ছে।`,
            dependentModules: dependents,
          });
        }
      }

      const oldAllowed = targetFlag.allowed;
      const oldEnabled = targetFlag.enabled;

      const updated = await tx.featureFlag.update({
        where: { id: targetFlag.id },
        data: { enabled },
      });

      // Write audit log
      await tx.auditLog.create({
        data: {
          id: uuidv7(),
          tenantId,
          actorUserId,
          action: "module.update",
          entityType: "Module",
          entityId: moduleKey,
          before: {
            key: moduleKey,
            allowed: oldAllowed,
            enabled: oldEnabled,
          },
          after: {
            key: moduleKey,
            allowed: updated.allowed,
            enabled: updated.enabled,
          },
        },
      });

      const info = MODULE_INFO[moduleKey];
      return {
        key: moduleKey,
        allowed: updated.allowed,
        enabled: updated.enabled,
        active: Boolean(updated.allowed && updated.enabled),
        nameBn: info?.nameBn || moduleKey,
        nameEn: info?.nameEn || moduleKey,
        description: info?.descriptionBn || "",
        dependsOn: info?.dependsOn || [],
      };
    });
  }
}
