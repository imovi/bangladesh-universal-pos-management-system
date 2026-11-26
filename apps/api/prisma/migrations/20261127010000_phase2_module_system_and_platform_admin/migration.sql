-- AlterTable
ALTER TABLE "feature_flags" ADD COLUMN "allowed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- Row Level Security and Grants for platform_admins
ALTER TABLE "platform_admins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_admins" FORCE ROW LEVEL SECURITY;

-- Explicitly revoke access to platform_admins from tenant role pos_app
REVOKE ALL ON TABLE public.platform_admins FROM pos_app;

-- Grant platform_admins management strictly to pos_system
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_admins TO pos_system;

CREATE POLICY "pos_system_platform_admins_policy" ON "platform_admins"
    AS PERMISSIVE FOR ALL
    TO pos_system
    USING (true)
    WITH CHECK (true);

-- Grants & Policy on feature_flags for pos_system (for tenant signup defaults and platform admin tenant module management)
GRANT SELECT, INSERT, UPDATE ON TABLE public.feature_flags TO pos_system;

DROP POLICY IF EXISTS "pos_system_feature_flags_policy" ON "feature_flags";
CREATE POLICY "pos_system_feature_flags_policy" ON "feature_flags"
    AS PERMISSIVE FOR ALL
    TO pos_system
    USING (true)
    WITH CHECK (true);
