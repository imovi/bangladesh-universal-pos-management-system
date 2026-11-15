import { z } from "zod";
import { BUSINESS_TYPES } from "./types.js";

export const TenantSignupSchema = z.object({
  companyName: z.string().trim().min(2).max(100),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message:
        "Slug must contain only lowercase alphanumeric characters and hyphens",
    }),
  businessType: z.enum(BUSINESS_TYPES),
  owner: z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email(),
    phone: z.string().trim().min(10).max(20),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters long")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[0-9]/, "Password must contain at least one number"),
    pin: z
      .string()
      .regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits")
      .optional(),
  }),
  branch: z.object({
    name: z.string().trim().min(2).max(100),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(2)
      .max(20)
      .regex(
        /^[A-Z0-9_-]+$/,
        "Branch code must be alphanumeric with optional dashes or underscores",
      ),
    address: z.string().trim().max(255).optional(),
  }),
});

export type TenantSignupDto = z.infer<typeof TenantSignupSchema>;

export const LoginSchema = z.object({
  tenantSlug: z.string().trim().toLowerCase().min(3).max(50),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, "Password is required"),
});

export type LoginDto = z.infer<typeof LoginSchema>;

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export type RefreshTokenDto = z.infer<typeof RefreshTokenSchema>;

export const CreateBranchSchema = z.object({
  name: z.string().trim().min(2).max(100),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9_-]+$/, "Branch code must be alphanumeric"),
  address: z.string().trim().max(255).optional(),
});

export type CreateBranchDto = z.infer<typeof CreateBranchSchema>;

export const UpdateBranchSchema = CreateBranchSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type UpdateBranchDto = z.infer<typeof UpdateBranchSchema>;

export const CreateUserSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().min(10).max(20).optional(),
  password: z.string().min(8),
  pin: z
    .string()
    .regex(/^\d{4,6}$/)
    .optional(),
  roleIds: z
    .array(z.string().uuid())
    .min(1, "At least one role must be assigned"),
  branchIds: z.array(z.string().uuid()).optional(),
});

export type CreateUserDto = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().min(10).max(20).optional(),
  isActive: z.boolean().optional(),
  roleIds: z.array(z.string().uuid()).optional(),
  branchIds: z.array(z.string().uuid()).optional(),
});

export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;

export const CreateRoleSchema = z.object({
  name: z.string().trim().min(2).max(50),
  permissionKeys: z
    .array(z.string())
    .min(1, "At least one permission required"),
});

export type CreateRoleDto = z.infer<typeof CreateRoleSchema>;

export const UpdateRoleSchema = z.object({
  name: z.string().trim().min(2).max(50).optional(),
  permissionKeys: z.array(z.string()).min(1).optional(),
});

export type UpdateRoleDto = z.infer<typeof UpdateRoleSchema>;
