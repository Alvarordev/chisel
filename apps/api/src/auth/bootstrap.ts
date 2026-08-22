import { auth, ensureAuthSchema } from "./index.ts";
import { ensureUser } from "../db/system.ts";

const email = process.env.AUTH_BOOTSTRAP_EMAIL?.trim();
const password = process.env.AUTH_BOOTSTRAP_PASSWORD;
const name = process.env.AUTH_BOOTSTRAP_NAME?.trim() || "Chisel Owner";

if (!email || !password) {
  throw new Error("Set AUTH_BOOTSTRAP_EMAIL and AUTH_BOOTSTRAP_PASSWORD to create the first user");
}

if (password.length < 12) {
  throw new Error("AUTH_BOOTSTRAP_PASSWORD must be at least 12 characters");
}

await ensureAuthSchema();
const context = await auth.$context;
const existing = await context.internalAdapter.findUserByEmail(email, { includeAccounts: false });

if (existing?.user) {
  throw new Error(`A user already exists for ${email}`);
}

const user = await context.internalAdapter.createUser({
  name,
  email,
  image: null,
  emailVerified: true,
}, { method: "admin" });

await context.internalAdapter.linkAccount({
  userId: user.id,
  providerId: "credential",
  issuer: "local:credential",
  accountId: user.id,
  password: await context.password.hash(password),
});

await ensureUser({ id: user.id, email: user.email });
console.log(`Created Chisel user ${user.email} (${user.id})`);
