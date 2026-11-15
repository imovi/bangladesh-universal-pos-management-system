-- Fix 1: Make max_discount_percent NOT NULL DEFAULT 0 with CHECK constraint

-- 1. Clamp any existing values outside 0..100
UPDATE roles
SET max_discount_percent = 0
WHERE max_discount_percent < 0;

UPDATE roles
SET max_discount_percent = 100
WHERE max_discount_percent > 100;

-- 2. Update NULLs according to system role rules
-- Owner gets 100
UPDATE roles
SET max_discount_percent = 100
WHERE max_discount_percent IS NULL AND is_system = true AND name = 'Owner';

-- Manager gets 20
UPDATE roles
SET max_discount_percent = 20
WHERE max_discount_percent IS NULL AND is_system = true AND name = 'Manager';

-- Cashier gets 5
UPDATE roles
SET max_discount_percent = 5
WHERE max_discount_percent IS NULL AND is_system = true AND name = 'Cashier';

-- Every other NULL (custom roles or other system roles like Store Keeper) becomes 0
UPDATE roles
SET max_discount_percent = 0
WHERE max_discount_percent IS NULL;

-- 3. Set NOT NULL and DEFAULT 0
ALTER TABLE roles
ALTER COLUMN max_discount_percent SET DEFAULT 0,
ALTER COLUMN max_discount_percent SET NOT NULL;

-- 4. Add CHECK constraint 0..100
ALTER TABLE roles
ADD CONSTRAINT roles_max_discount_percent_check
CHECK (max_discount_percent >= 0 AND max_discount_percent <= 100);
