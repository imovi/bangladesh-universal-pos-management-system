import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { TenantContextService } from "../database/tenant-context.service.js";
import {
  getActiveModules,
  MODULE_INFO,
  type ModuleKey,
} from "@universal-pos/shared";
import { REQUIRED_MODULES_METADATA_KEY } from "../decorators/require-module.decorator.js";

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredModules = this.reflector.getAllAndOverride<ModuleKey[]>(
      REQUIRED_MODULES_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredModules || requiredModules.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<any>();
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException({
        code: "MODULE_DISABLED",
        message: "টেন্যান্ট শনাক্ত করা যায়নি।",
      });
    }

    // Read the tenant's flags once per request under tenant context
    if (!req._activeModules) {
      const flags = await this.tenantContext.runWithTenant(tenantId, async (tx) => {
        return tx.featureFlag.findMany({
          select: { key: true, allowed: true, enabled: true },
        });
      });
      req._activeModules = getActiveModules(flags);
    }

    for (const key of requiredModules) {
      if (!req._activeModules.includes(key)) {
        const info = MODULE_INFO[key];
        const name = info?.nameBn || key;
        throw new ForbiddenException({
          code: "MODULE_DISABLED",
          message: `${name} মডিউলটি আপনার দোকানের জন্য চালু করা নেই।`,
          moduleKey: key,
        });
      }
    }

    return true;
  }
}
