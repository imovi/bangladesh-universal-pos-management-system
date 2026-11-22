import { PrismaClient } from "@prisma/client";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run cleanup-dev-test-data in production environment (NODE_ENV=production)");
  }

  const rawUrl =
    process.env.DATABASE_URL ||
    "postgresql://pos_admin:pos_secret@localhost:5432/universal_pos?schema=public";

  const parsed = new URL(rawUrl);
  const dbName = parsed.pathname.replace(/^\//, "");

  // Strict guard: MUST be 'universal_pos'
  if (dbName !== "universal_pos") {
    throw new Error(
      `[cleanup-dev-test-data] Target database is '${dbName}'. This script is strictly for cleaning leftover test data from 'universal_pos'.`
    );
  }

  console.log(`[cleanup-dev-test-data] Connecting to '${dbName}'...`);
  const prisma = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  try {
    const testProducts = await prisma.product.findMany({
      where: {
        OR: [
          { name: { startsWith: "Custom Polo Shirt" } },
          { variants: { some: { sku: { startsWith: "POLO-" } } } },
        ],
      },
      include: {
        variants: {
          include: {
            stockLevels: true,
          },
        },
      },
    });

    console.log(`[cleanup-dev-test-data] Found ${testProducts.length} leftover test product(s).`);

    for (const p of testProducts) {
      let totalStock = 0;
      for (const v of p.variants) {
        for (const sl of v.stockLevels) {
          totalStock += Number(sl.qty || 0);
        }
      }

      console.log(
        `[cleanup-dev-test-data] Product '${p.name}' (ID: ${p.id}): ${p.variants.length} variant(s), total stock: ${totalStock}.`
      );

      // Deactivate product and variants to preserve ledger integrity and prevent bypassing stock movements
      await prisma.product.update({
        where: { id: p.id },
        data: {
          isActive: false,
        },
      });

      await prisma.productVariant.updateMany({
        where: { productId: p.id },
        data: {
          isActive: false,
        },
      });

      console.log(`[cleanup-dev-test-data] -> Deactivated product '${p.name}' and all its variants.`);
    }

    console.log(`[cleanup-dev-test-data] Cleanup complete.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`[cleanup-dev-test-data] Error:`, err.message);
  process.exit(1);
});
