import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { v7 as uuidv7 } from "uuid";
import dotenv from "dotenv";

dotenv.config();

function parseArgs() {
  const args = process.argv.slice(2);
  let email = "";
  let name = "";

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--email=")) {
      email = arg.split("=")[1];
    } else if (arg === "--email" && i + 1 < args.length) {
      email = args[++i];
    } else if (arg.startsWith("--name=")) {
      name = arg.split("=")[1];
    } else if (arg === "--name" && i + 1 < args.length) {
      name = args[++i];
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }

  if (!email && positional.length > 0) {
    email = positional[0];
  }
  if (!name && positional.length > 1) {
    name = positional.slice(1).join(" ");
  }

  return { email: email.trim().toLowerCase(), name: name.trim() };
}

async function main() {
  const { email, name } = parseArgs();
  const password = process.env.PLATFORM_ADMIN_PASSWORD;

  if (!email || !name) {
    process.stderr.write(
      "Usage: npm run platform-admin:create -- --email <email> --name <name>\n" +
        "   or: PLATFORM_ADMIN_PASSWORD=... npm run platform-admin:create <email> <name>\n"
    );
    process.exit(1);
  }

  if (!password) {
    process.stderr.write(
      "Error: PLATFORM_ADMIN_PASSWORD environment variable is required\n"
    );
    process.exit(1);
  }

  if (password.length < 8) {
    process.stderr.write(
      "Error: PLATFORM_ADMIN_PASSWORD must be at least 8 characters long\n"
    );
    process.exit(1);
  }

  const passwordHash = await argon2.hash(password);

  const dbUrl =
    process.env.MIGRATION_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgresql://pos_runtime:pos_runtime_secret@localhost:5432/universal_pos?schema=public";

  const prisma = new PrismaClient({
    datasources: { db: { url: dbUrl } },
  });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE pos_system;`;

      const existing = await tx.platformAdmin.findUnique({
        where: { email },
      });

      if (existing) {
        await tx.platformAdmin.update({
          where: { id: existing.id },
          data: {
            name,
            passwordHash,
            isActive: true,
          },
        });
      } else {
        await tx.platformAdmin.create({
          data: {
            id: uuidv7(),
            email,
            name,
            passwordHash,
            isActive: true,
          },
        });
      }
    });

    process.stdout.write(
      `Platform admin successfully created/updated: ${email} (${name})\n`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  process.stderr.write(`Failed to create platform admin: ${err.message}\n`);
  process.exit(1);
});
