import {
  Injectable,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { SystemDbService } from "../../common/database/system-db.service.js";
import argon2 from "argon2";
import {
  TenantSignupDto,
  TenantSignupSchema,
  SYSTEM_ROLE_PERMISSIONS,
  DEFAULT_ROLE_MAX_DISCOUNT,
  SystemRole,
} from "@universal-pos/shared";

@Injectable()
export class TenantsService {
  constructor(private readonly systemDb: SystemDbService) {}

  async signup(payload: TenantSignupDto, ip?: string) {
    const parseResult = TenantSignupSchema.safeParse(payload);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid registration details",
        details: parseResult.error.errors.map((e) => ({
          field: e.path.join("."),
          issue: e.message,
        })),
      });
    }

    const { companyName, slug, businessType, owner, branch } = parseResult.data;

    // Verify slug uniqueness through system service
    const existingTenant = await this.systemDb.findTenantBySlug(slug);
    if (existingTenant) {
      throw new ConflictException({
        code: "SLUG_ALREADY_EXISTS",
        message: "This tenant slug is already taken. Please choose another.",
      });
    }

    // Hash credentials
    const passwordHash = await argon2.hash(owner.password);
    const pinHash = owner.pin ? await argon2.hash(owner.pin) : null;

    // Prepare system roles
    const rolesToSeed = (
      Object.entries(SYSTEM_ROLE_PERMISSIONS) as [SystemRole, string[]][]
    ).map(([roleName, permissions]) => ({
      name: roleName,
      isSystem: true,
      permissions,
      maxDiscountPercent: DEFAULT_ROLE_MAX_DISCOUNT[roleName] ?? null,
    }));

    // Atomically provision entire tenant via SystemDbService transaction
    return this.systemDb.createTenantWithInitialData({
      companyName,
      slug,
      businessType,
      branch: {
        name: branch.name,
        code: branch.code,
        address: branch.address,
      },
      roles: rolesToSeed,
      owner: {
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        passwordHash,
        pinHash,
      },
      ip,
    });
  }
}
